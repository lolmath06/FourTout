import { getIcon } from "./icons";

interface IconProps {
  /** Nom d'icône lucide, tel que déclaré dans le registre des outils. */
  name: string | undefined;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, className, strokeWidth = 1.75 }: IconProps) {
  const Component = getIcon(name);
  return <Component size={size} className={className} strokeWidth={strokeWidth} aria-hidden />;
}
