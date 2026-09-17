//! One bounded writer keeps PostgreSQL and retries out of simulation ticks.
use serde_json::Value;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    time::Duration,
};
#[cfg(test)]
type MemoryLog = Arc<std::sync::Mutex<Vec<(String, Value, bool)>>>;

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
    /// Collects submitted records in memory so server tests can exercise the
    /// finalization path without a database.
    #[cfg(test)]
    pub fn memory(capacity: usize) -> (Self, MemoryLog) {
        let log: MemoryLog = Default::default();
        let sink = log.clone();
        let (tx, rx) = mpsc::sync_channel::<Request>(capacity);
        std::thread::Builder::new()
            .name("naval-results-test".into())
            .spawn(move || {
                while let Ok(request) = rx.recv() {
                    match request {
                        Request::Record(id, record, finished) => {
                            sink.lock().unwrap().push((id, record, finished))
                        }
                        Request::Flush(ack) => {
                            let _ = ack.send(());
                        }
                    }
                }
            })
            .unwrap();
        (
            Self {
                tx,
                healthy: Arc::new(AtomicBool::new(true)),
                accounts: None,
            },
            log,
        )
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
