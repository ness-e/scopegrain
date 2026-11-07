# Persistence and Recovery

Apply to persistent state. Specify what atomicity, durability and recovery
actually mean for the storage and failure model.
Use exclusive ownership or appropriate concurrency control for writes.
Test interruption and corruption; do not infer power-loss durability from
one successful rename or a normal process exit.
Never destroy existing user data to recover a test or clear a stale lock.
