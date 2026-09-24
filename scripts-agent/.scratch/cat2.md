# Diccionario de columnas — CATALOGO2

- Registros: 0
- Longitud de registro: 127 bytes
- Columnas: 17

| # | Columna | Tipo | Bytes | Dec | Offset |
|---|---------|------|-------|-----|--------|
| 0 | `UpdateTime` | ?0x0e | 8 |  | 5 |
| 1 | `EntryID` | ?0x0f | 4 |  | 13 |
| 2 | `TxnID` | int32 | 4 |  | 17 |
| 3 | `TxnReady` | int32 | 4 |  | 21 |
| 4 | `ThisDBID` | int32 | 4 |  | 25 |
| 5 | `AllDBID` | ?0x06 | 9 |  | 29 |
| 6 | `TableName` | ?0x08 | 30 |  | 38 |
| 7 | `CRC` | int32 | 4 |  | 68 |
| 8 | `CompatLock` | logico | 1 |  | 72 |
| 9 | `IdentColumns` | ?0x06 | 9 |  | 73 |
| 10 | `RecordNumber` | int32 | 4 |  | 82 |
| 11 | `UpdateType` | char | 1 |  | 86 |
| 12 | `RecordData` | ?0x06 | 9 |  | 87 |
| 13 | `BlobData` | ?0x06 | 9 |  | 96 |
| 14 | `ErrorCode` | int32 | 4 |  | 105 |
| 15 | `ErrorInfo` | ?0x05 | 9 |  | 109 |
| 16 | `ErrorInfo2` | ?0x05 | 9 |  | 118 |
