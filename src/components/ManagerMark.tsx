import type { ManagerId } from "../types";
import npmLogo from "../assets/managers/npm.svg";
import pnpmLogo from "../assets/managers/pnpm.svg";
import yarnLogo from "../assets/managers/yarn.svg";
import nvmLogo from "../assets/managers/nvm.svg";
import homebrewLogo from "../assets/managers/homebrew.svg";
import mavenLogo from "../assets/managers/maven.svg";
import pythonLogo from "../assets/managers/python.svg";
import cargoLogo from "../assets/managers/cargo.png";
import dockerLogo from "../assets/managers/docker.svg";
import bunLogo from "../assets/managers/bun.svg";
import uvLogo from "../assets/managers/uv.svg";
import fvmLogo from "../assets/managers/fvm.svg";
import androidLogo from "../assets/managers/android.svg";

const managerLogos: Record<ManagerId, string> = {
  Npm: npmLogo,
  Pnpm: pnpmLogo,
  Yarn: yarnLogo,
  Nvm: nvmLogo,
  Homebrew: homebrewLogo,
  Maven: mavenLogo,
  Pip: pythonLogo,
  Cargo: cargoLogo,
  Docker: dockerLogo,
  Bun: bunLogo,
  Uv: uvLogo,
  Fvm: fvmLogo,
  AndroidSdk: androidLogo,
};

export function ManagerMark({ id }: { id: ManagerId }) {
  return (
    <span aria-hidden="true" className="studio-mark" data-manager={id}>
      <img alt="" height={22} src={managerLogos[id]} width={22} />
    </span>
  );
}
