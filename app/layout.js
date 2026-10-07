import "./globals.css";
import Sidebar from "./components/Sidebar";

export const metadata = {
  title: "Taatsu Production & Shipment",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">
        <Sidebar />
        <main className="min-h-screen px-6 pb-10 pt-20 md:ml-64 md:px-10 md:pt-10">
          {children}
        </main>
      </body>
    </html>
  );
}