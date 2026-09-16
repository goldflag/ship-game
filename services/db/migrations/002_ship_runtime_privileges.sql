-- Runtime saves append revisions and idempotency records. Only the design head
-- changes; deleting a design removes its history via the existing foreign key.
REVOKE UPDATE, DELETE ON ships.revisions FROM ships_api;
REVOKE UPDATE, DELETE ON ships.operations FROM ships_api;
