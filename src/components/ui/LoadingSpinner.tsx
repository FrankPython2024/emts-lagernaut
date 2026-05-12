export function LoadingSpinner({ size = "md", text }: { size?: "sm" | "md" | "lg"; text?: string }) {
  const sizes = { sm: "w-4 h-4 border-2", md: "w-8 h-8 border-3", lg: "w-12 h-12 border-4" };
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className={`${sizes[size]} border-[#202F61]/20 border-t-[#202F61] dark:border-[#008BD2]/20 dark:border-t-[#008BD2] rounded-full animate-spin`}
      />
      {text && <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{text}</span>}
    </div>
  );
}

export function PageLoader({ text = "Wird geladen..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}
