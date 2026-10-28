import "server-only";
import QRCode from "qrcode";

/** SVG do QR Code (correção de erro M, tolera pequenos danos/sujeira na impressão). */
export function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
}

export const tableUrl = (siteUrl: string, token: string) => `${siteUrl}/q/${token}`;
export const menuUrl = (siteUrl: string, slug: string) => `${siteUrl}/m/${slug}`;
