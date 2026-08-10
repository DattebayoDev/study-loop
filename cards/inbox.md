# Study Loop — inbox
# Append cards here. Format: front | back | tech/path | #concept #concept
# Blank lines and lines starting with # are ignored.

Aurora failover | stops retry storms with a circuit breaker during the ~30 s leader election window | AWS/Database/Aurora | #resilience
Idempotent producer | dedupes retries via producer-id + sequence number per partition; broker rejects duplicates in the same epoch | Kafka/Delivery | #resilience #consistency
Virtual threads (JDK 21) | mount/unmount on OS threads at blocking points — thousands of threads on a small carrier pool | Java/Concurrency | #performance
ECS task | the containerized unit ECS schedules onto capacity; defined by an immutable task definition | AWS/Compute/ECS |
