import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function countRecords() {
  try {
    const counts = {
      quickButtonLayout: await prisma.quickButtonLayout.count(),
      supportTicket: await prisma.supportTicket.count(),
      invitation: await prisma.invitation.count(),
      role: await prisma.role.count(),
      userRole: await prisma.userRole.count(),
    };
    
    console.log(JSON.stringify(counts, null, 2));
    await prisma.$disconnect();
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

countRecords();
