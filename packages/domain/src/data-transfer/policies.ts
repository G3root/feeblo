import * as Policy from "../policy";

/**
 * The authorization gates for board CSV transfer.
 *
 * Both the service methods and the frontend's `hasPermission` checks resolve
 * the same named permissions (see `docs/permissions.md`), so a contributor
 * cannot stage an import, confirm one, or export a board by calling the
 * transport directly. They live here rather than inline so the two directions
 * cannot drift into different permission ids.
 */
export const canImportPosts = (organizationId: string): Policy.Policy =>
  Policy.canPermission(organizationId, "boards.importPosts");

export const canExportData = (organizationId: string): Policy.Policy =>
  Policy.canPermission(organizationId, "boards.exportData");
