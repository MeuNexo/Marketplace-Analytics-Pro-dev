interface Props {
  title: string;
  children?: React.ReactNode;
  lastUpdated?: Date | null;
}

export function MLPageHeader({ title, children, lastUpdated }: Props) {
  const formattedDate = lastUpdated
    ? lastUpdated.toLocaleString("pt-BR")
    : null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">{title}</h1>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
          {formattedDate ? `Última sinc: ${formattedDate}` : "Nunca sincronizado"}
        </p>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}
