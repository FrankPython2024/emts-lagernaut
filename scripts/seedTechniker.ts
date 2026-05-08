import { PrismaClient, UserRolle } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const TECHNIKER = [
  { kuerzel: "FS",  name: "Felix Schmidt"    },
  { kuerzel: "VS",  name: "Valentin Sauer"   },
  { kuerzel: "MG",  name: "Max Grüner"       },
  { kuerzel: "HG",  name: "Hans Groß"        },
  { kuerzel: "AB",  name: "Anton Bauer"      },
  { kuerzel: "AB2", name: "Anna Berg"        },
  { kuerzel: "MF",  name: "Max Fischer"      },
  { kuerzel: "JS2", name: "Jan Schubert"     },
  { kuerzel: "TH1", name: "Thomas Hoffmann"  },
  { kuerzel: "WH",  name: "Werner Huber"     },
];

async function main() {
  const hash = await bcrypt.hash("techniker123", 12);

  for (const t of TECHNIKER) {
    const email = `${t.kuerzel.toLowerCase()}@afb-soemmreda.de`;

    const user = await prisma.user.upsert({
      where:  { kuerzel: t.kuerzel },
      update: { name: t.name, email, aktiv: true },
      create: {
        email,
        kuerzel:      t.kuerzel,
        name:         t.name,
        passwordHash: hash,
        rolle:        UserRolle.TECHNIKER,
        aktiv:        true,
      },
    });

    console.log(`✅ ${t.kuerzel.padEnd(4)} — ${t.name} (${user.id})`);
  }

  console.log(`\n🎉 ${TECHNIKER.length} Techniker angelegt/aktualisiert`);
  console.log("🔑 Passwort: techniker123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
