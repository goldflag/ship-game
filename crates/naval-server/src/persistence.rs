//! One bounded writer keeps PostgreSQL and retries out of simulation ticks.
#[cfg(test)]
use rusqlite::Connection;
use serde_json::Value;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    time::Duration,
};
enum Request {
    Record(String, Value, bool),
    Flush(SyncSender<()>),
}
#[derive(Clone)]
pub struct Writer {
    tx: SyncSender<Request>,
    pub healthy: Arc<AtomicBool>,
    accounts: Option<[String; 2]>,
}
impl Writer {
    #[cfg(test)]
    pub fn open(
        path: &std::path::Path,
        capacity: usize,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?
        }
        let db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(1))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, record TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0);")?;
        // Live simulation cannot be reconstructed after process loss. Retain metadata
        // and record an explicit abort, without inventing a winner or current tonnage.
        db.execute("UPDATE matches SET record=json_set(record,'$.status','infrastructure-abort','$.abortReason','server-restart'),finished=1 WHERE finished=0",[])?;
        let (tx, rx) = mpsc::sync_channel::<Request>(capacity);
        let healthy = Arc::new(AtomicBool::new(true));
        let health = healthy.clone();
        std::thread::Builder::new()
            .name("naval-results".into())
            .spawn(move || {
                while let Ok(request) = rx.recv() {
                    let (id, record, finished) = match request {
                        Request::Record(id, record, finished) => (id, record, finished),
                        Request::Flush(ack) => {
                            let _ = ack.send(());
                            continue;
                        }
                    };
                    let json = record.to_string();
                    loop {
                        match write(&db, &id, &json, finished) {
                            Ok(()) => {
                                health.store(true, Ordering::Release);
                                break;
                            }
                            Err(e) => {
                                health.store(false, Ordering::Release);
                                eprintln!("Result persistence unavailable for match {id}: {e}");
                                std::thread::sleep(Duration::from_secs(1));
                            }
                        }
                    }
                }
            })?;
        Ok(Self {
            tx,
            healthy,
            accounts: None,
        })
    }
    pub fn open_postgres(url: &str, capacity: usize) -> Result<Self, Box<dyn std::error::Error>> {
        let mut db = connect(url)?;
        db.execute("UPDATE results.matches SET record=record || '{\"status\":\"infrastructure-abort\",\"abortReason\":\"server-restart\"}'::jsonb,finished=true WHERE NOT finished", &[])?;
        let url = url.to_string();
        let (tx, rx) = mpsc::sync_channel::<Request>(capacity);
        let healthy = Arc::new(AtomicBool::new(true));
        let health = healthy.clone();
        std::thread::Builder::new().name("naval-results".into()).spawn(move || {
            loop {
                let request = match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(request) => request,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        health.store(db.simple_query("SELECT 1").is_ok(), Ordering::Release);
                        if db.is_closed() && let Ok(next) = connect(&url) { db = next; }
                        continue;
                    }
                };
                let (id, record, finished) = match request {
                    Request::Flush(ack) => { let _ = ack.send(()); continue; }
                    Request::Record(id,record,finished) => (id,record,finished),
                };
                let a = record["accountIds"][0].as_str();
                let b = record["accountIds"][1].as_str();
                loop {
                    match db.execute("INSERT INTO results.matches(id,record,finished,account_a,account_b) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET record=excluded.record,finished=excluded.finished,account_a=excluded.account_a,account_b=excluded.account_b WHERE NOT results.matches.finished", &[&id,&record,&finished,&a,&b]) {
                        Ok(_) => { health.store(true,Ordering::Release); break; }
                        Err(_) => { health.store(false,Ordering::Release); eprintln!("Result storage unavailable for match {id}"); std::thread::sleep(Duration::from_secs(1)); if let Ok(next) = connect(&url) { db = next; } }
                    }
                }
            }
        })?;
        Ok(Self {
            tx,
            healthy,
            accounts: None,
        })
    }
    pub fn with_accounts(&self, accounts: [String; 2]) -> Self {
        let mut writer = self.clone();
        writer.accounts = Some(accounts);
        writer
    }
    /// Acknowledged only after every preceding synchronous commit.
    pub fn flush(&self) -> Result<(), String> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .send(Request::Flush(tx))
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
    pub fn submit(&self, id: String, mut record: Value, finished: bool) -> Result<(), String> {
        if let Some(accounts) = &self.accounts {
            record["accountIds"] = serde_json::json!(accounts);
        }
        self.tx
            .try_send(Request::Record(id, record, finished))
            .map_err(|_| {
                self.healthy.store(false, Ordering::Release);
                "Result queue is unavailable".into()
            })
    }
}
#[cfg(test)]
fn write(db: &Connection, id: &str, record: &str, finished: bool) -> rusqlite::Result<()> {
    db.execute("INSERT INTO matches(id,record,finished) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET record=excluded.record,finished=excluded.finished WHERE matches.finished=0",(id,record,finished))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flush_commits_results_and_restart_aborts_only_incomplete_matches() {
        let directory =
            std::env::temp_dir().join(format!("naval-results-{}", uuid::Uuid::new_v4()));
        let path = directory.join("matches.sqlite");
        let writer = Writer::open(&path, 8).unwrap();
        writer
            .submit(
                "live".into(),
                serde_json::json!({"status":"running"}),
                false,
            )
            .unwrap();
        writer
            .submit(
                "done".into(),
                serde_json::json!({"status":"finished","winner":"a"}),
                true,
            )
            .unwrap();
        writer.flush().unwrap();
        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM matches", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        drop(writer);
        let restarted = Writer::open(&path, 8).unwrap();
        restarted.flush().unwrap();
        let record = |id: &str| -> Value {
            serde_json::from_str(
                &db.query_row("SELECT record FROM matches WHERE id=?1", [id], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            )
            .unwrap()
        };
        assert_eq!(record("live")["abortReason"], "server-restart");
        assert_eq!(
            record("done"),
            serde_json::json!({"status":"finished","winner":"a"})
        );
        drop(restarted);
        drop(db);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn first_final_result_is_immutable() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE matches(id TEXT PRIMARY KEY,record TEXT,finished INTEGER)")
            .unwrap();
        write(&db, "match", "loading", false).unwrap();
        write(&db, "match", "victory", true).unwrap();
        write(&db, "match", "defeat", true).unwrap();
        write(&db, "match", "loading", false).unwrap();
        assert_eq!(
            db.query_row("SELECT record FROM matches WHERE id='match'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "victory"
        );
    }
}

fn connect(url: &str) -> Result<postgres::Client, postgres::Error> {
    let mut config: postgres::Config = url.parse()?;
    config
        .connect_timeout(Duration::from_secs(3))
        .tcp_user_timeout(Duration::from_secs(5))
        .keepalives_idle(Duration::from_secs(5))
        .keepalives_interval(Duration::from_secs(1))
        .keepalives_retries(3);
    let mut db = config.connect(postgres::NoTls)?;
    db.batch_execute("SET statement_timeout='5s'; SET synchronous_commit=on")?;
    Ok(db)
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    #[test]
    #[ignore = "requires POSTGRES_TEST_URL pointing to an isolated migrated database"]
    fn ordered_postgres_flush_terminal_immutability_and_restart_abort() {
        let url = std::env::var("POSTGRES_TEST_URL").unwrap();
        assert!(url.contains("_test"), "Use an isolated test database");
        let suffix = uuid::Uuid::new_v4().to_string();
        let live = format!("live-{suffix}");
        let done = format!("done-{suffix}");
        let writer = Writer::open_postgres(&url, 8)
            .unwrap()
            .with_accounts(["account-a".into(), "account-b".into()]);
        writer
            .submit(live.clone(), serde_json::json!({"status":"running"}), false)
            .unwrap();
        writer
            .submit(
                done.clone(),
                serde_json::json!({"status":"finished","winner":"a"}),
                true,
            )
            .unwrap();
        writer
            .submit(
                done.clone(),
                serde_json::json!({"status":"finished","winner":"b"}),
                true,
            )
            .unwrap();
        writer.flush().unwrap();
        let mut db = connect(&url).unwrap();
        let row = db
            .query_one(
                "SELECT record,account_a,account_b FROM results.matches WHERE id=$1",
                &[&done],
            )
            .unwrap();
        assert_eq!(row.get::<_, Value>(0)["winner"], "a");
        assert_eq!(row.get::<_, String>(1), "account-a");
        assert_eq!(row.get::<_, String>(2), "account-b");
        drop(writer);
        let restarted = Writer::open_postgres(&url, 8).unwrap();
        restarted.flush().unwrap();
        let row = db
            .query_one(
                "SELECT record,finished FROM results.matches WHERE id=$1",
                &[&live],
            )
            .unwrap();
        assert_eq!(row.get::<_, Value>(0)["abortReason"], "server-restart");
        assert!(row.get::<_, bool>(1));
        assert_eq!(
            db.query_one("SELECT record FROM results.matches WHERE id=$1", &[&done])
                .unwrap()
                .get::<_, Value>(0)["winner"],
            "a"
        );
    }
}
