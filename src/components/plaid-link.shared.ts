// Shared types for Plaid Link (web and iPhone).

export interface PlaidLinkSuccess {
  publicToken: string;
  institution: { id: string; name: string } | null;
}

export interface PlaidLinkProps {
  /** Short-lived token from the plaid-link-token function. */
  linkToken: string;
  onSuccess: (result: PlaidLinkSuccess) => void;
  /** Called when the user closes Link, or it can't open (with a message). */
  onExit: (error?: string) => void;
}
