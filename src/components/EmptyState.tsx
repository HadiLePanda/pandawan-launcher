interface EmptyStateProps {
  title: string;
  description?: string;
  /**
   * Only render the blurb when it says something actionable. A sentence that
   * restates the title ("No games yet. There are no games.") pads the panel
   * without telling the reader anything they can act on.
   */
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2 className="empty-state-title">{title}</h2>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
