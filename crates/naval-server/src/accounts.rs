use axum::http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
#[derive(Clone)]
pub struct Accounts {
    client: reqwest::Client,
    url: String,
    secret: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    account_id: String,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Artifact {
    pub key: String,
    pub source: Box<serde_json::value::RawValue>,
    pub result: Box<serde_json::value::RawValue>,
}
#[derive(Deserialize)]
pub struct Prepared {
    pub ids: Vec<String>,
    pub artifacts: Vec<Arc<Artifact>>,
}
impl Accounts {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let secret = std::env::var("SERVICE_SECRET")?;
        if secret.len() < 32 {
            return Err("SERVICE_SECRET is too short".into());
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .build()?,
            url: std::env::var("ACCOUNTS_URL")?,
            secret,
        })
    }
    fn request(&self, path: &str, headers: &HeaderMap) -> reqwest::RequestBuilder {
        self.client
            .get(format!("{}{path}", self.url))
            .header("x-service-secret", &self.secret)
            .header(
                "cookie",
                headers
                    .get("cookie")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or(""),
            )
    }
    pub async fn session(&self, headers: &HeaderMap) -> Result<String, StatusCode> {
        let response = self
            .request("/internal/session", headers)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if response.status().as_u16() == 401 {
            return Err(StatusCode::UNAUTHORIZED);
        }
        if !response.status().is_success() {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok(response
            .json::<Session>()
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .account_id)
    }
    pub async fn prepare(
        &self,
        headers: &HeaderMap,
        fleet: &[naval_protocol::FleetReference],
    ) -> Result<Prepared, String> {
        let response = self
            .client
            .post(format!("{}/internal/prepare", self.url))
            .header("x-service-secret", &self.secret)
            .header(
                "cookie",
                headers
                    .get("cookie")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or(""),
            )
            .json(&serde_json::json!({"fleet":fleet}))
            .timeout(Duration::from_secs(110))
            .send()
            .await
            .map_err(|_| "Ship preparation unavailable")?;
        if !response.status().is_success() {
            return Err(response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v["error"].as_str().map(str::to_owned))
                .unwrap_or("Ship preparation failed".into()));
        }
        response
            .json()
            .await
            .map_err(|_| "Invalid preparation response".into())
    }
}
pub type Compiled = BTreeMap<String, Arc<naval_sim::vessel::CompiledShip>>;
pub fn insert_artifacts(
    catalog: &mut naval_sim::catalog::Catalog,
    compiled: &mut Compiled,
    artifacts: &[Arc<Artifact>],
) -> Result<(), String> {
    for artifact in artifacts {
        #[derive(Deserialize)]
        struct Definition {
            definition: naval_sim::definition::ShipDefinition,
        }
        let d = serde_json::from_str::<Definition>(artifact.result.get())
            .map_err(|e| e.to_string())?
            .definition;
        if !d.id.starts_with("local-") || d.air_wing.is_some() {
            return Err("Invalid custom identity".into());
        }
        if let Some(existing) = catalog.definitions.get(&d.id) {
            if serde_json::to_value(existing).map_err(|e| e.to_string())?
                != serde_json::to_value(&d).map_err(|e| e.to_string())?
            {
                return Err("Custom identity collision".into());
            }
            continue;
        }
        naval_sim::catalog::validate_definition(&d).map_err(|e| e.to_string())?;
        let mass = naval_sim::rules::match_displacement_kg(d.hull.mass_kg)
            .ok_or("Invalid displacement")?;
        let id = d.id.clone();
        catalog.fleet_entries.insert(
            id.clone(),
            naval_sim::rules::FleetEntry {
                ship_id: id.clone(),
                displacement_kg: mass,
                carrier: false,
            },
        );
        catalog.definitions.insert(id.clone(), Arc::new(d));
        compiled.insert(id.clone(), Arc::new(catalog.compile(&id)?));
    }
    Ok(())
}
