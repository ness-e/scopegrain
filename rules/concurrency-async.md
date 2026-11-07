# Concurrency and Async

Apply only where concurrent or asynchronous code exists.
Do not block an event loop with unbounded CPU or synchronous I/O work.
Avoid holding inappropriate locks across suspension points.
Bound concurrency, queues and resource lifetime using the actual runtime.
Test cancellation, contention, ordering and failure cleanup.
Do not impose Tokio, a particular mutex type or a language-specific API
without evidence that this is the project's runtime.
