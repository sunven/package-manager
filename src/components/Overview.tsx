import { StatCard } from "./ui";

export function Overview({
  managerCount,
  readyManagers,
  totalBytes,
  totalPackages,
  unsupported,
}: {
  managerCount: string;
  readyManagers: string;
  totalBytes: string;
  totalPackages: string;
  unsupported: string;
}) {
  return (
    <section className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
      <StatCard label="管理器" value={managerCount} />
      <StatCard label="已就绪" value={readyManagers} />
      <StatCard label="软件包" value={totalPackages} />
      <StatCard label="总占用" value={totalBytes} />
      <StatCard label="不支持" value={unsupported} />
    </section>
  );
}
