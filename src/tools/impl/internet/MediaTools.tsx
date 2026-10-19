import type { ToolComponentProps } from "@/tools/implementations";
import { MediaFlow } from "./MediaFlow";

export function MediaDownloadTool(_props: ToolComponentProps) {
  return <MediaFlow variant="download" />;
}

export function MediaUrlExcerptTool(_props: ToolComponentProps) {
  return <MediaFlow variant="excerpt" />;
}

export function MediaUrlGifTool(_props: ToolComponentProps) {
  return <MediaFlow variant="gif" />;
}
