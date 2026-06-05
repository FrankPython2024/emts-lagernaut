// Rolle → Start-/Home-Pfad. Single Source of Truth gegen Redirect-Loops:
// sowohl die Root-Seite "/" als auch die Middleware leiten anhand DIESER Map um,
// damit keine Rolle in einen Bereich geschickt wird, der sie zurückwirft.
//
// Reine Funktion ohne Imports → auch im Edge-Runtime der Middleware nutzbar.
export function homeFor(rolle?: string | null): string {
  switch (rolle) {
    case "ADMIN":
    case "BETRACHTER":
    case "ADMIN_READONLY":
      return "/admin";
    case "PICKUP":
      return "/pickup";
    case "TECHNIKER":
    default:
      return "/techniker";
  }
}
