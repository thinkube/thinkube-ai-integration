/**
 * Column row — vendored from the upstream, minus the "Add Column" button and
 * the column-level Droppable (the six methodology columns are fixed).
 */
import styles from "./column-list.module.scss";
import { Column } from "./column";
import { ThinkingSpaceColumn } from "../../types";

export function ColumnList({
  columns,
}: {
  columns: ThinkingSpaceColumn[];
}): JSX.Element {
  return (
    <div className={styles.columnList}>
      {columns.map((column) => (
        <Column key={column.id} column={column} />
      ))}
    </div>
  );
}
