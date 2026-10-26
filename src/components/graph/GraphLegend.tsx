import styles from "./graph.module.css";

function Sample({ children }: { children: React.ReactNode }) {
  return (
    <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden>
      {children}
    </svg>
  );
}

const line = <line x1="17" y1="0" x2="17" y2="20" stroke="var(--graph-0)" strokeWidth="2.2" />;

/** Explains every symbol and colour used by the graph. */
export function GraphLegend() {
  return (
    <div className={styles.legend} role="region" aria-label="Graph legend">
      <div className={styles.legendItem}>
        <Sample>
          {line}
          <circle cx="17" cy="10" r="5" fill="var(--graph-0)" stroke="var(--bg)" strokeWidth="1.5" />
        </Sample>
        <span><strong>Commit.</strong> One saved snapshot. Lines connect each commit to its parent below it.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          {line}
          <circle cx="17" cy="10" r="6.8" fill="var(--bg)" stroke="var(--graph-3)" strokeWidth="2.6" />
          <circle cx="17" cy="10" r="2.4" fill="var(--graph-3)" />
        </Sample>
        <span><strong>Merge commit.</strong> Ring with a dot: it has two or more parents. The first parent is the branch that received the merge.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          {line}
          <circle cx="17" cy="10" r="8.5" fill="none" stroke="var(--graph-1)" strokeWidth="1.3" strokeDasharray="2 2" />
          <circle cx="17" cy="10" r="5" fill="var(--graph-1)" stroke="var(--bg)" strokeWidth="1.5" />
        </Sample>
        <span><strong>Divergence point.</strong> Dotted ring: two or more lines of history start from this commit.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          {line}
          <circle cx="17" cy="10" r="10.5" fill="none" stroke="var(--text)" strokeWidth="2" />
          <circle cx="17" cy="10" r="5" fill="var(--graph-0)" stroke="var(--bg)" strokeWidth="1.5" />
        </Sample>
        <span><strong>HEAD.</strong> White outer ring and a HEAD label: the commit you are on now.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          <line x1="17" y1="10" x2="17" y2="20" stroke="var(--graph-0)" strokeWidth="2.2" strokeDasharray="3 3" />
          <circle cx="17" cy="10" r="5" fill="var(--bg)" stroke="var(--graph-0)" strokeWidth="2" strokeDasharray="3 2" />
        </Sample>
        <span><strong>Uncommitted changes.</strong> Dashed hollow node above HEAD when the working tree has changes.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          <path d="M 4 4 C 14 4, 20 16, 30 16" stroke="var(--graph-2)" strokeWidth="2.2" fill="none" />
          <path d="M 4 16 L 30 16" stroke="var(--graph-0)" strokeWidth="2.2" fill="none" />
        </Sample>
        <span><strong>Coloured lines.</strong> Each colour is one parallel line of history. Colours only tell lines apart; they can be reused once a line ends. A curve joining another line is a branch point or a merge.</span>
      </div>
      <div className={styles.legendItem}>
        <Sample>
          {line}
          <circle cx="17" cy="10" r="9.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 2" />
          <circle cx="17" cy="10" r="6.8" fill="var(--bg)" stroke="var(--graph-3)" strokeWidth="2.6" />
          <circle cx="17" cy="10" r="2.4" fill="var(--graph-3)" />
        </Sample>
        <span><strong>Related merge.</strong> Dashed blue ring while branches are highlighted: this merge brought a highlighted branch&apos;s commits into another line, so it stays visible.</span>
      </div>
      <div className={styles.legendItem}>
        <span className={styles.compareKeyA}>A</span>
        <span className={styles.compareKeyB}>B</span>
        <span><strong>Comparing two branches.</strong> A coloured stripe on the row&apos;s left edge marks commits only in A or only in B; a grey stripe marks shared history.</span>
      </div>
      <div className={styles.legendItem}>
        <span className={`${styles.refBadge} ${styles.refLocal}`} style={{ background: "var(--graph-0)" }}>main</span>
        <span className={`${styles.refBadge} ${styles.refRemote}`} style={{ color: "var(--graph-0)", borderColor: "var(--graph-0)" }}>origin/main</span>
        <span className={`${styles.refBadge} ${styles.refTag}`} style={{ color: "var(--graph-0)", borderColor: "var(--graph-0)" }}>🏷 v1.0</span>
        <span>Filled: local branch · outlined: remote-tracking · dashed: tag.</span>
      </div>
    </div>
  );
}
