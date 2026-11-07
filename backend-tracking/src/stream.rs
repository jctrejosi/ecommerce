//! Broker: Redis Streams.
//!
//! Contrato (ver `broker-tracking/README.md`):
//!
//! * Stream principal `tracking:events`, consumer group `tracking-workers`.
//! * Cada mensaje lleva un solo campo `payload` con el JSON de
//!   [`StreamMessage`].
//! * `XACK` solo después de confirmar la escritura en PostgreSQL.
//! * Los mensajes que no se pueden procesar van a `tracking:dead`.

use redis::aio::MultiplexedConnection;
use redis::streams::{
    StreamAutoClaimOptions, StreamAutoClaimReply, StreamMaxlen, StreamReadOptions, StreamReadReply,
};
use redis::AsyncCommands;

use crate::model::StreamMessage;

const STREAM_FIELD: &str = "payload";

/// Entrada leída del stream, todavía sin interpretar.
#[derive(Debug, Clone)]
pub struct StreamEntry {
    pub id: String,
    pub payload: Option<String>,
}

pub struct StreamProducer {
    conn: MultiplexedConnection,
    stream: String,
    max_len: usize,
}

impl StreamProducer {
    pub async fn connect(
        redis_url: &str,
        stream: impl Into<String>,
        max_len: usize,
    ) -> anyhow::Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = client.get_multiplexed_async_connection().await?;
        Ok(Self {
            conn,
            stream: stream.into(),
            max_len,
        })
    }

    pub async fn publish(&mut self, message: &StreamMessage) -> anyhow::Result<String> {
        let payload = message.to_json()?;
        let id: String = self
            .conn
            .xadd_maxlen(
                &self.stream,
                StreamMaxlen::Approx(self.max_len),
                "*",
                &[(STREAM_FIELD, payload)],
            )
            .await?;
        Ok(id)
    }

    pub async fn ping(&mut self) -> anyhow::Result<()> {
        let _: String = redis::cmd("PING").query_async(&mut self.conn).await?;
        Ok(())
    }
}

pub struct StreamConsumer {
    conn: MultiplexedConnection,
    stream: String,
    group: String,
    consumer: String,
    dead_letter: String,
    dead_letter_max_len: usize,
}

impl StreamConsumer {
    pub async fn connect(
        redis_url: &str,
        stream: impl Into<String>,
        group: impl Into<String>,
        consumer: impl Into<String>,
        dead_letter: impl Into<String>,
        dead_letter_max_len: usize,
    ) -> anyhow::Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = client.get_multiplexed_async_connection().await?;
        Ok(Self {
            conn,
            stream: stream.into(),
            group: group.into(),
            consumer: consumer.into(),
            dead_letter: dead_letter.into(),
            dead_letter_max_len: dead_letter_max_len.max(1_000),
        })
    }

    /// Crea el consumer group si no existe (`MKSTREAM` crea el stream vacío).
    pub async fn ensure_group(&mut self) -> anyhow::Result<()> {
        let result: redis::RedisResult<String> = self
            .conn
            .xgroup_create_mkstream(&self.stream, &self.group, "0")
            .await;

        match result {
            Ok(_) => {
                tracing::info!(stream = %self.stream, group = %self.group, "consumer group creado");
                Ok(())
            }
            Err(err) if err.to_string().contains("BUSYGROUP") => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    /// Lee mensajes nuevos (`>`) para este consumidor.
    pub async fn read(
        &mut self,
        count: usize,
        block_ms: usize,
    ) -> anyhow::Result<Vec<StreamEntry>> {
        let options = StreamReadOptions::default()
            .group(self.group.as_str(), self.consumer.as_str())
            .count(count.max(1))
            .block(block_ms.max(1));

        let reply: StreamReadReply = self
            .conn
            .xread_options(&[self.stream.as_str()], &[">"], &options)
            .await?;

        Ok(reply
            .keys
            .into_iter()
            .flat_map(|key| key.ids)
            .map(|entry| StreamEntry {
                id: entry.id,
                payload: entry
                    .map
                    .get(STREAM_FIELD)
                    .and_then(|value| redis::from_redis_value::<String>(value).ok()),
            })
            .collect())
    }

    /// Reclama mensajes pendientes de otros consumidores (o de este mismo si
    /// quedaron sin `XACK`).
    pub async fn claim_stale(
        &mut self,
        min_idle_ms: u64,
        count: usize,
    ) -> anyhow::Result<Vec<StreamEntry>> {
        let options = StreamAutoClaimOptions::default().count(count.max(1));
        let reply: StreamAutoClaimReply = self
            .conn
            .xautoclaim_options(
                &self.stream,
                &self.group,
                &self.consumer,
                min_idle_ms,
                "0-0",
                options,
            )
            .await?;

        if !reply.deleted_ids.is_empty() {
            tracing::debug!(
                deleted = reply.deleted_ids.len(),
                "mensajes reclamados ya no existen"
            );
        }

        Ok(reply
            .claimed
            .into_iter()
            .map(|entry| StreamEntry {
                id: entry.id,
                payload: entry
                    .map
                    .get(STREAM_FIELD)
                    .and_then(|value| redis::from_redis_value::<String>(value).ok()),
            })
            .collect())
    }

    pub async fn ack(&mut self, ids: &[String]) -> anyhow::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let _: i64 = self.conn.xack(&self.stream, &self.group, ids).await?;
        Ok(())
    }

    /// Publica el mensaje fallido en el dead letter stream.
    pub async fn dead_letter(&mut self, reason: &str, entry: &StreamEntry) -> anyhow::Result<()> {
        let payload = entry.payload.as_deref().unwrap_or("");
        let _: String = self
            .conn
            .xadd_maxlen(
                &self.dead_letter,
                StreamMaxlen::Approx(self.dead_letter_max_len),
                "*",
                &[
                    ("reason", reason.to_string()),
                    ("stream_id", entry.id.clone()),
                    ("payload", payload.to_string()),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn ping(&mut self) -> anyhow::Result<()> {
        let _: String = redis::cmd("PING").query_async(&mut self.conn).await?;
        Ok(())
    }
}
