// What the pane asks of Microsoft for « Fichiers OneDrive » (R4, docs/MICROSOFT365.md): a token for
// our API, signed in with the account Office already knows, and the files (or the folder, BTP stage
// 1D) the person picks in OneDrive's own picker. The real port is ./office.ts; the harness and the E2E run use ./stand-in.ts.

/** A file or a folder picked in OneDrive: the API reads it itself from then on. */
export interface PickedFile {
  driveId: string;
  itemId: string;
}

/** Where OneDrive's picker opens and the token it wants (the API's `picker`). */
export interface PickerTarget {
  baseUrl: string;
  scope: string;
  /** Where that token comes from, when not the sign-in's own (a personal OneDrive: `consumers`). */
  authority?: string;
}

/**
 * - `unsupported`: this Office cannot sign in from the pane (no nested app authentication: an older
 *   version, or a workbook not opened from OneDrive or SharePoint on the web).
 * - `cancelled`: the person closed Microsoft's window.
 * - `failed`: anything else; trying again may help.
 */
export class MicrosoftPortError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'cancelled' | 'failed',
    detail: string = reason,
  ) {
    super(detail);
    this.name = 'MicrosoftPortError';
  }
}

export interface MicrosoftPort {
  /** A token for our API (`api://<client id>/.default`); Microsoft asks consent the first time. */
  signIn(input: { clientId: string; scope: string }): Promise<string>;
  /** OneDrive's picker over the pane; [] when the person closes it without picking. */
  pick(input: {
    clientId: string;
    picker: PickerTarget;
    /** `folder`: one folder, whose documents the API reads (BTP stage 1D). Default: workbooks. */
    kind?: 'files' | 'folder';
    /** The picker's own frame: its title and its « Fermer » button. */
    labels: { title: string; close: string };
  }): Promise<PickedFile[]>;
}

/**
 * Scout (plan §R4): the open workbook's address (`Office.context.document.url`) is on OneDrive or
 * SharePoint. Learn does not describe these addresses; the hosts below are those Excel shows for a
 * personal OneDrive (d.docs.live.net, onedrive.live.com) and a work one or a SharePoint site
 * (*.sharepoint.com). A personal workbook on the web is on d.docs.live.net (2026-10-22).
 * TODO(verify): on a work and a SharePoint account (docs/MICROSOFT365.md).
 */
export function onMicrosoftCloud(url: string | null): boolean {
  let host: string;
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'd.docs.live.net' || host === 'onedrive.live.com' || host.endsWith('.sharepoint.com')
  );
}
