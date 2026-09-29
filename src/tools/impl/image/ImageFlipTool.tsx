import { RotateFlipTool } from "./RotateFlipTool";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageFlipTool({ tool }: ToolComponentProps) {
  return <RotateFlipTool tool={tool} rotationEnabled={false} />;
}
