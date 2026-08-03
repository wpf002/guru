import { apiGet } from "../../../lib/api";
import { requireStep } from "../../../lib/gate";
import { BuildRoadmap } from "./BuildRoadmap";

export default async function SetupRoadmap() {
  await requireStep("roadmap");
  const roadmap = await apiGet<{ id: string }>("/roadmap");

  if (roadmap) {
    return (
      <>
        <h1>Your strategy is ready</h1>
        <p className="lede">A phased plan from where you are to where you want to be.</p>
        <BuildRoadmap done />
      </>
    );
  }

  return (
    <>
      <h1>Build your strategy</h1>
      <p className="lede">
        Guru turns your brief and your network into a phased plan. Every post it writes
        traces back to a piece of it.
      </p>
      <BuildRoadmap />
    </>
  );
}
