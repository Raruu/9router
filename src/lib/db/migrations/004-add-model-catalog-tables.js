// Persist the reconstructible OpenRouter cache and portable user catalog rules.
import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 4,
  name: "add-model-catalog-tables",
  up(db) {
    for (const name of ["openRouterModels", "userModelCatalog"]) {
      const definition = TABLES[name];
      db.exec(buildCreateTableSql(name, definition));
      for (const indexSql of definition.indexes || []) db.exec(indexSql);
    }
  },
};

export default migration;
