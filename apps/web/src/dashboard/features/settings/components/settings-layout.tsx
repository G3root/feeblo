import { cn } from "~/lib/utils";

interface RootProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}
function Root({ children, className, ...props }: RootProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:py-12",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface HeaderProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

function Header({ children, className, ...props }: HeaderProps) {
  return (
    <div
      className={cn("flex flex-col items-start gap-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface HeaderTitleProps extends React.ComponentProps<"h1"> {
  children: React.ReactNode;
}

function HeaderTitle({ children, className, ...props }: HeaderTitleProps) {
  return (
    <h1
      className={cn(
        "font-semibold text-2xl leading-tight tracking-tight",
        className
      )}
      {...props}
    >
      {children}
    </h1>
  );
}

interface HeaderDescriptionProps extends React.ComponentProps<"p"> {
  children: React.ReactNode;
}

function HeaderDescription({
  children,
  className,
  ...props
}: HeaderDescriptionProps) {
  return (
    <p className={cn("text-muted-foreground text-sm", className)} {...props}>
      {children}
    </p>
  );
}

interface ContentProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

function Content({ children, className, ...props }: ContentProps) {
  return (
    <div className={cn("flex flex-col gap-12", className)} {...props}>
      {children}
    </div>
  );
}

export const SettingsLayout = {
  Root,
  Header,
  HeaderTitle,
  HeaderDescription,
  Content,
};
