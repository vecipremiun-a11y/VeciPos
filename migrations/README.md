# migrations/ — fuente de verdad del esquema

Cada cambio de **estructura** de la base (CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX…)
se escribe aquí como un archivo `.sql` numerado. **Nunca** se edita el esquema a mano en la
consola de Turso. Si no está en este folder, no existe.

## Convención de nombres
```
0001_descripcion_corta.sql
0002_otra_cosa.sql
```
El número (`0001`, `0002`, …) es la **versión**. `migrate-all` lleva la cuenta por base en
`system_settings.db_migration_version` y aplica solo las que falten, en orden.

## Reglas para escribir una migración
- **Idempotente** siempre que se pueda: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
  Para `ADD COLUMN` (que no tiene IF NOT EXISTS), asegúrate de que la columna no exista aún en
  ninguna base (o protégela). Así, si una corrida se reintenta, no rompe.
- Solo cambios **aditivos** en producción (agregar tablas/columnas/índices). Renombres/borrados
  necesitan cuidado especial.
- Puede tener varias sentencias separadas por `;` (se aplican con `executeMultiple`).

## Flujo
```
1. Escribes la migración aquí (0001_...sql)
2. La pruebas en desarrollo:  npm run migrate-all -- --only=poskem --apply
3. commit + push (despliega el código)
4. La aplicas a TODAS:        npm run migrate-all -- --apply
5. Verificas:                 npm run verify-all
```

Estado inicial: **sin migraciones** (todas las bases ya están al día con el esquema actual,
`db_migration_version = 0`). La primera que escribas será `0001`.
