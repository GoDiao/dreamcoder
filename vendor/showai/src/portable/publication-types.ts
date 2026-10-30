import type { PackageRevisionRef } from "../components/custom/types";

export interface PublishedComponentLocator {
  ref: PackageRevisionRef & { kind: "component" };
  bundleRef: PackageRevisionRef;
  url: string;
  sha256: string;
  bytes: number;
  manifestUrl: string;
  manifestIntegrity: string;
  verifiedAt: string;
}

export interface PublicationFile {
  file: string;
  sha256: string;
  bytes: number;
}

export interface PublicationManifest {
  format: "showai-publication";
  version: 1;
  releaseId: string;
  packages: (PublicationFile & { ref: PackageRevisionRef })[];
  metadata: PublicationFile;
}

export interface PreparedPublication {
  status: "prepared";
  path: string;
  manifestPath: string;
  manifest: PublicationManifest;
  bytes: number;
}

export interface VerifiedPublication {
  status: "published";
  manifestUrl: string;
  manifestIntegrity: string;
  releaseId: string;
  verifiedAt: string;
  components: PublishedComponentLocator[];
}
