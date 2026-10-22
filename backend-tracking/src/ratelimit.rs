//! Rate limit en memoria (token bucket).
//!
//! La ingesta es un servicio único (o pocas réplicas), así que un limitador en
//! memoria es suficiente y evita una dependencia extra. Si se escala
//! horizontalmente, conviene moverlo a Redis.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Bucket {
    tokens: f64,
    last_refill: Instant,
    last_seen: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Bucket>>,
    requests_per_min: f64,
    events_per_min: f64,
    last_cleanup: Mutex<Instant>,
}

impl RateLimiter {
    pub fn new(requests_per_min: u32, events_per_min: u32) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            requests_per_min: requests_per_min.max(1) as f64,
            events_per_min: events_per_min.max(1) as f64,
            last_cleanup: Mutex::new(Instant::now()),
        }
    }

    /// Consume `count` peticiones. Devuelve `false` si se excede el límite.
    pub fn check_requests(&self, origin: &str, count: u32) -> bool {
        self.take(
            &format!("req:{origin}"),
            count as f64,
            self.requests_per_min,
        )
    }

    /// Consume `count` eventos. Devuelve `false` si se excede el límite.
    pub fn check_events(&self, origin: &str, count: u32) -> bool {
        self.take(&format!("evt:{origin}"), count as f64, self.events_per_min)
    }

    fn take(&self, key: &str, tokens: f64, capacity: f64) -> bool {
        let mut buckets = match self.buckets.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let now = Instant::now();
        let allowed = {
            let bucket = buckets.entry(key.to_string()).or_insert_with(|| Bucket {
                tokens: capacity,
                last_refill: now,
                last_seen: now,
            });

            let elapsed = now
                .saturating_duration_since(bucket.last_refill)
                .as_secs_f64();
            bucket.tokens = (bucket.tokens + elapsed * (capacity / 60.0)).min(capacity);
            bucket.last_refill = now;
            bucket.last_seen = now;

            if bucket.tokens >= tokens {
                bucket.tokens -= tokens;
                true
            } else {
                false
            }
        };

        self.cleanup_if_needed(&mut buckets, now);
        allowed
    }

    fn cleanup_if_needed(&self, buckets: &mut HashMap<String, Bucket>, now: Instant) {
        let Ok(mut last_cleanup) = self.last_cleanup.lock() else {
            return;
        };

        if now.saturating_duration_since(*last_cleanup) < Duration::from_secs(60) {
            return;
        }

        buckets.retain(|_, bucket| {
            now.saturating_duration_since(bucket.last_seen) < Duration::from_secs(600)
        });
        *last_cleanup = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permite_hasta_el_limite_y_luego_bloquea() {
        let limiter = RateLimiter::new(2, 10);
        assert!(limiter.check_requests("ip-1", 1));
        assert!(limiter.check_requests("ip-1", 1));
        assert!(!limiter.check_requests("ip-1", 1));
        // Otro origen tiene su propio bucket.
        assert!(limiter.check_requests("ip-2", 1));
    }
}
