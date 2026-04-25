import "./globals.css";
import { Metadata } from "next";
export const metadata: Metadata = {
  title: "SJT 시뮬레이션 — 상황판단 역량 진단",
  description: "AI 기반 Situational Judgement Test. 가상 직원들과 실시간 대화를 통해 리더십 역량을 진단합니다.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
