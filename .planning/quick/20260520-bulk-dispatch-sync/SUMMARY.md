---
slug: bulk-dispatch-sync
status: complete
completed_at: "2026-05-20"
commit: a64965c
---

# Summary: bulk-dispatch-sync-jobs

Edge function bulk-dispatch-sync-jobs deployada (v1, ACTIVE).
handleSync no MLPedidos substituído: 1 chamada → N jobs na fila.
Polling de 15s detecta fim da fila e recarrega pedidos automaticamente.
