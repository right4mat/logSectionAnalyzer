import Link from "next/link";

import { LatestPost } from "~/app/_components/post";
import { api, HydrateClient } from "~/trpc/server";
import LogAnalyzer from "~/app/_components/LogAnalyzer";

export default async function Home() {
  const hello = await api.post.hello({ text: "from tRPC" });

  void api.post.getLatest.prefetch();

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0a4275] to-[#073052] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Log Section{" "}
            <span className="text-[#4dabf7]">Analyzer</span>
          </h1>

          <LogAnalyzer />
        </div>
      </main>
    </HydrateClient>
  );
}
