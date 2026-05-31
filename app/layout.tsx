import "./globals.css";
import type { ReactNode } from "react";
import { VaultProvider } from "@/contexts/VaultContext";
import { EngineProvider } from "@/contexts/EngineContext";
import { ActivityProvider } from "@/contexts/ActivityContext";
import { SiweGate } from "@/components/auth/SiweGate";
import { VaultGate } from "@/components/auth/VaultGate";
import { TopBar } from "@/components/common/TopBar";
import { Sidebar } from "@/components/common/Sidebar";

export const metadata = { title: "Market Maker", description: "Admin trading console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiweGate>
          <VaultProvider>
            <VaultGate>
              <ActivityProvider>
                <EngineProvider>
                  <div className="flex flex-col min-h-screen">
                    <TopBar />
                    <div className="flex flex-1">
                      <Sidebar />
                      <main className="flex-1 p-6">{children}</main>
                    </div>
                  </div>
                </EngineProvider>
              </ActivityProvider>
            </VaultGate>
          </VaultProvider>
        </SiweGate>
      </body>
    </html>
  );
}
