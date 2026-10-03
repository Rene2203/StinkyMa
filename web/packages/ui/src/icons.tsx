import {
  Archive,
  AudioLines,
  Bell,
  Briefcase,
  Calendar,
  Contact,
  Euro,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Flag,
  Folder,
  Image,
  Inbox,
  Mail,
  Mails,
  Newspaper,
  Presentation,
  Send,
  ShieldAlert,
  ShieldX,
  Star,
  Trash2,
  User,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { fileExtension, type MailboxRole, type MessageCategory } from "@stinkyma/core";
import type { SidebarItemKind } from "./store.js";

export const roleIcon: Record<MailboxRole, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  trash: Trash2,
  archive: Archive,
  spam: ShieldX,
  custom: Folder,
};

export function sidebarIcon(kind: SidebarItemKind): LucideIcon {
  switch (kind.type) {
    case "unifiedInbox":
      return Mails;
    case "unread":
      return Mail;
    case "flagged":
      return Flag;
    case "important":
      return Star;
    case "screener":
      return UserCheck;
    case "mailbox":
      return roleIcon[kind.mailbox.role];
  }
}

export const categoryIcon: Record<MessageCategory, LucideIcon> = {
  personal: User,
  work: Briefcase,
  newsletter: Newspaper,
  notification: Bell,
  invoice: Euro,
  appointment: Calendar,
  spam_suspect: ShieldAlert,
};

export function attachmentIcon(filename: string): LucideIcon {
  switch (fileExtension(filename)) {
    case "pdf":
    case "doc":
    case "docx":
    case "rtf":
    case "txt":
    case "md":
      return FileText;
    case "jpg":
    case "jpeg":
    case "png":
    case "heic":
    case "gif":
    case "tiff":
    case "webp":
      return Image;
    case "xls":
    case "xlsx":
    case "csv":
      return FileSpreadsheet;
    case "ppt":
    case "pptx":
      return Presentation;
    case "zip":
      return FileArchive;
    case "ics":
      return Calendar;
    case "vcf":
      return Contact;
    case "m4a":
    case "mp3":
    case "wav":
      return AudioLines;
    case "mp4":
    case "mov":
      return Film;
    default:
      return File;
  }
}
