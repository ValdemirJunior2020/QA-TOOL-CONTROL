// Keep the original gateway path stable for launchers and frontend health checks.
// The local-RAG gateway preserves the same API while adding txtai, LightRAG,
// and optional ai-memory retrieval before final QA verification.
import './gateway-rag.mjs'
