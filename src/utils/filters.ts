import type { ManagerSnapshot, PackageRow } from "../types";

export interface IndexedPackage {
  pkg: PackageRow;
  index: number;
}

export function filteredHomebrewPackages(manager: ManagerSnapshot, filter: "All" | "Formulae" | "Casks" | "Outdated" | "Leaves") {
  return indexedPackages(manager).filter(({ pkg }) => {
    switch (filter) {
      case "Formulae":
        return pkg.kind === "Formula";
      case "Casks":
        return pkg.kind === "Cask";
      case "Outdated":
        return pkg.signals.includes("Outdated");
      case "Leaves":
        return pkg.signals.includes("Leaf");
      case "All":
      default:
        return true;
    }
  });
}

export function filteredMavenPackages(manager: ManagerSnapshot, filter: "All" | "Duplicates" | "Snapshots") {
  return indexedPackages(manager).filter(({ pkg }) => {
    switch (filter) {
      case "Duplicates":
        return pkg.signals.includes("DuplicateVersions");
      case "Snapshots":
        return pkg.signals.includes("Snapshot");
      case "All":
      default:
        return true;
    }
  });
}

export function filteredPipPackages(manager: ManagerSnapshot, filter: "All" | "Outdated" | "Editable" | "UserSite" | "DirectUrl") {
  return indexedPackages(manager).filter(({ pkg }) => {
    switch (filter) {
      case "Outdated":
        return pkg.signals.includes("Outdated");
      case "Editable":
        return pkg.signals.includes("Editable");
      case "UserSite":
        return pkg.signals.includes("UserSite");
      case "DirectUrl":
        return pkg.signals.includes("DirectUrl");
      case "All":
      default:
        return true;
    }
  });
}

export function indexedPackages(manager: ManagerSnapshot): IndexedPackage[] {
  return manager.packages.map((pkg, index) => ({ pkg, index }));
}
