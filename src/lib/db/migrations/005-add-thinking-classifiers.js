// Persist user-defined Thinking Effort Classifier profiles (System One decision
// models that map a prompt to a thinking level). Additive table; the row payload
// lives in `data` like proxyPools/providerNodes.
import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 5,
  name: "add-thinking-classifiers",
  up(db) {
    const definition = TABLES.thinkingClassifiers;
    db.exec(buildCreateTableSql("thinkingClassifiers", definition));
    for (const indexSql of definition.indexes || []) db.exec(indexSql);
  },
};

export default migration;
