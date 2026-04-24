import "./globals.css";
import { Metadata } from "next";
export const metadata: Metadata = {
  title: "SJT 시뮬레이션 | AI 기반 상황판단 테스트",
  description: "가상의 직원들과 대화하며 리더십과 의사결정 역량을 측정합니다.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
