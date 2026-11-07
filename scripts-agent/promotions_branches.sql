-- Alcance por sucursal para promociones dinámicas.
BEGIN;

CREATE TABLE IF NOT EXISTS promotion_branches (
  promotion_id bigint NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  branch_id bigint NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_branches_branch
  ON promotion_branches (branch_id);

COMMIT;
