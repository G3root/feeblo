import {
  Card,
  CardPanel,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@feeblo/ui/card";

function Root({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardPanel className="grid gap-6">{children}</CardPanel>
      </Card>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Controls({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3">{children}</div>;
}

function List({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3">{children}</div>;
}

export const MembersSettingsLayout = {
  Root,
  Section,
  Controls,
  List,
};
