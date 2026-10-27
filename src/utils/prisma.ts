import { PrismaClient } from '@prisma/client';

// Instance unique partagée par tout le bot (évite 20+ connexions SQLite concurrentes)
export const prisma = new PrismaClient();
