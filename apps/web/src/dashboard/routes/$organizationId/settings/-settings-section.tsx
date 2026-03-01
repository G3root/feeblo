import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

interface SettingsSectionProps {
  description: string;
  title: string;
}

export function SettingsSection({ title, description }: SettingsSectionProps) {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This section is ready for configuration controls.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
