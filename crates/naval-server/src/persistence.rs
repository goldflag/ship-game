//! One bounded writer keeps SQLite and retries out of simulation ticks.
use rusqlite::Connection;
use serde_json::Value;
use std::{
    path::Path,
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
}
impl Writer {
    pub fn open(path: &Path, capacity: usize) -> Result<Self, Box<dyn std::error::Error>> {
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
        Ok(Self { tx, healthy })
    }
    /// Acknowledged only after every preceding write commits with synchronous FULL.
    pub fn flush(&self) -> Result<(), String> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .send(Request::Flush(tx))
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
    pub fn submit(&self, id: String, record: Value, finished: bool) -> Result<(), String> {
        self.tx
            .try_send(Request::Record(id, record, finished))
            .map_err(|_| {
                self.healthy.store(false, Ordering::Release);
                "Result queue is unavailable".into()
            })
    }
}
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
