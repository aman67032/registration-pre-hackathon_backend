import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

// ─── CSV Parsing ────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());
    return fields;
}

function parseCSV(filePath: string, minFields: number): string[][] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
    const rows: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCSVLine(line);
        if (fields.length >= minFields) rows.push(fields);
    }
    return rows;
}

// ─── Normalize helpers ──────────────────────────────────────────────────────

function normalizeCourse(c: string): string {
    const lower = c.toLowerCase().trim();
    if (lower === 'btech' || lower === 'b.tech') return 'BTech';
    if (lower === 'bba') return 'BBA';
    if (lower === 'bdes') return 'BDes';
    if (lower === 'hsb') return 'HSB';
    return 'BTech';
}

function normalizeResidency(r: string): string {
    const lower = r.toLowerCase().trim();
    if (lower.includes('host')) return 'Hosteller';
    return 'Day Scholar';
}

function normalizeMessFood(mf: string): boolean {
    return mf.toLowerCase().trim() === 'yes';
}

function normalizeTeamName(name: string): string {
    return name.toLowerCase().trim().replace(/[\s_-]+/g, ' ');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function syncAll() {
    const dryRun = !process.argv.includes('--apply');

    if (dryRun) {
        console.log('DRY RUN MODE -- No changes will be written.');
        console.log('Run with --apply to commit changes.\n');
    } else {
        console.log('APPLY MODE -- Changes WILL be written to the database.\n');
    }

    await mongoose.connect(MONGO_URI!);
    console.log('Connected to MongoDB\n');

    const db = mongoose.connection.db!;
    const collection = db.collection('Data_Collection_Pre-Hackthon_1');

    // Fetch all existing teams
    const dbTeams = await collection.find({}).toArray();
    console.log(`Found ${dbTeams.length} teams in database\n`);

    // Build lookup: normalized team name -> DB doc
    const dbTeamMap = new Map<string, any>();
    for (const t of dbTeams) {
        dbTeamMap.set(normalizeTeamName(t.teamName), t);
    }

    let updatedCount = 0;
    let insertedCount = 0;
    let skippedCount = 0;

    // ═══════════════════════════════════════════════════════════════════
    // PART 1: Sync from final.csv (check-in, board, room, team#, members)
    // ═══════════════════════════════════════════════════════════════════
    console.log('=== PART 1: Syncing from final.csv (check-in, board, members) ===\n');

    const finalPath = path.resolve(__dirname, '../../../registration_prehackthon/public/final.csv');
    const finalRows = parseCSV(finalPath, 10);
    console.log(`Parsed ${finalRows.length} rows from final.csv\n`);

    // Group final.csv rows by team name
    interface FinalRow {
        name: string; email: string; whatsApp: string; rollNumber: string;
        course: string; batch: string; residency: string; messFood: string;
        role: string; teamName: string; checkIn: string; boardAlloted: string;
        roomNumber: string; teamNumber: string;
    }

    const finalTeamMap = new Map<string, FinalRow[]>();
    for (const fields of finalRows) {
        const row: FinalRow = {
            name: fields[0], email: fields[1], whatsApp: fields[2],
            rollNumber: fields[3], course: fields[4], batch: fields[5],
            residency: fields[6], messFood: fields[7], role: fields[8],
            teamName: fields[9], checkIn: fields[10] || '', boardAlloted: fields[11] || '',
            roomNumber: fields[12] || '', teamNumber: fields[13] || '',
        };
        if (!row.teamName.trim()) continue;
        const key = row.teamName.trim();
        if (!finalTeamMap.has(key)) finalTeamMap.set(key, []);
        finalTeamMap.get(key)!.push(row);
    }

    for (const [teamName, members] of finalTeamMap) {
        const leader = members.find(m => m.role.toLowerCase() === 'leader');
        if (!leader) continue;

        const memberRows = members.filter(m => m.role.toLowerCase() !== 'leader');
        const normed = normalizeTeamName(teamName);
        const dbTeam = dbTeamMap.get(normed);

        if (dbTeam) {
            // Update existing team
            const updates: Record<string, any> = {};
            const changes: string[] = [];

            const checkIn = leader.checkIn.trim().toLowerCase() === 'in';
            const board = ['yes', 'yers', 'yez'].includes(leader.boardAlloted.trim().toLowerCase());

            if (checkIn && !dbTeam.isCheckedIn) {
                updates.isCheckedIn = true;
                changes.push('isCheckedIn: false -> true');
            }
            if (board && !dbTeam.extensionBoardGiven) {
                updates.extensionBoardGiven = true;
                changes.push('extensionBoardGiven: false -> true');
            }
            if (leader.roomNumber.trim() && leader.roomNumber.trim() !== (dbTeam.roomNumber || '')) {
                updates.roomNumber = leader.roomNumber.trim();
                changes.push(`roomNumber: "${dbTeam.roomNumber || ''}" -> "${leader.roomNumber.trim()}"`);
            }
            if (leader.teamNumber.trim() && leader.teamNumber.trim() !== (dbTeam.allocatedTeamId || '')) {
                updates.allocatedTeamId = leader.teamNumber.trim();
                changes.push(`allocatedTeamId: "${dbTeam.allocatedTeamId || ''}" -> "${leader.teamNumber.trim()}"`);
            }

            // Leader change
            const normEmail = leader.email.toLowerCase().trim();
            if (normEmail && normEmail !== (dbTeam.leaderEmail || '').toLowerCase()) {
                updates.leaderName = leader.name;
                updates.leaderEmail = normEmail;
                updates.leaderWhatsApp = leader.whatsApp.replace(/\s/g, '');
                updates.leaderRollNumber = leader.rollNumber.toUpperCase().trim();
                updates.leaderResidency = normalizeResidency(leader.residency);
                updates.leaderMessFood = normalizeMessFood(leader.messFood);
                updates.leaderCourse = normalizeCourse(leader.course);
                updates.leaderBatch = leader.batch.trim();
                changes.push(`leader changed: ${dbTeam.leaderName} -> ${leader.name}`);
            }

            // Member changes
            if (memberRows.length === 3) {
                const dbEmails = new Set((dbTeam.members || []).map((m: any) => (m.email || '').toLowerCase().trim()));
                const csvEmails = new Set(memberRows.map(m => m.email.toLowerCase().trim()));
                const membersChanged = memberRows.some(m => !dbEmails.has(m.email.toLowerCase().trim())) ||
                    (dbTeam.members || []).some((m: any) => !csvEmails.has((m.email || '').toLowerCase().trim()));

                if (membersChanged) {
                    updates.members = memberRows.map(m => ({
                        name: m.name,
                        email: m.email.toLowerCase().trim(),
                        whatsApp: m.whatsApp.replace(/\s/g, ''),
                        rollNumber: m.rollNumber.toUpperCase().trim(),
                        residency: normalizeResidency(m.residency),
                        messFood: normalizeMessFood(m.messFood),
                        course: normalizeCourse(m.course),
                        batch: m.batch.trim(),
                    }));
                    changes.push('members updated');
                }
            }

            if (changes.length > 0) {
                console.log(`UPDATE "${dbTeam.teamName}": ${changes.join(', ')}`);
                if (!dryRun) await collection.updateOne({ _id: dbTeam._id }, { $set: updates });
                updatedCount++;
            }
        } else {
            // New team from final.csv
            if (memberRows.length !== 3) {
                console.log(`SKIP "${teamName}" - ${memberRows.length} members (need 3)`);
                skippedCount++;
                continue;
            }

            const newDoc = {
                teamName,
                leaderName: leader.name,
                leaderEmail: leader.email.toLowerCase().trim(),
                leaderWhatsApp: leader.whatsApp.replace(/\s/g, ''),
                leaderRollNumber: leader.rollNumber.toUpperCase().trim(),
                leaderResidency: normalizeResidency(leader.residency),
                leaderMessFood: normalizeMessFood(leader.messFood),
                leaderCourse: normalizeCourse(leader.course),
                leaderBatch: leader.batch.trim(),
                isCheckedIn: leader.checkIn.trim().toLowerCase() === 'in',
                extensionBoardGiven: ['yes', 'yers', 'yez'].includes(leader.boardAlloted.trim().toLowerCase()),
                roomNumber: leader.roomNumber.trim() || undefined,
                allocatedTeamId: leader.teamNumber.trim() || undefined,
                members: memberRows.map(m => ({
                    name: m.name,
                    email: m.email.toLowerCase().trim(),
                    whatsApp: m.whatsApp.replace(/\s/g, ''),
                    rollNumber: m.rollNumber.toUpperCase().trim(),
                    residency: normalizeResidency(m.residency),
                    messFood: normalizeMessFood(m.messFood),
                    course: normalizeCourse(m.course),
                    batch: m.batch.trim(),
                })),
                createdAt: new Date(),
            };

            console.log(`INSERT "${teamName}" (leader: ${leader.name})`);
            if (!dryRun) await collection.insertOne(newDoc);
            insertedCount++;
        }
    }

    console.log(`\nPart 1 done: ${updatedCount} updated, ${insertedCount} inserted, ${skippedCount} skipped\n`);

    // ═══════════════════════════════════════════════════════════════════
    // PART 2: Sync submission data (problem statements, GitHub repos)
    // ═══════════════════════════════════════════════════════════════════
    console.log('=== PART 2: Syncing submission data (PS, GitHub, room, team#) ===\n');

    const subPath = path.resolve(__dirname, '../../../registration_prehackthon/public/Pre-Hack Submission of PS and GitHub Repo.csv');
    const subRows = parseCSV(subPath, 9);
    console.log(`Parsed ${subRows.length} submission rows\n`);

    // Submission CSV: Id, Start time, Completion time, Email, Name, Team Name, Team No., Room No., Problem Statement, GitHub Repo Link
    let subUpdated = 0;
    let subNotFound = 0;

    // Re-fetch teams after part 1 updates
    const dbTeams2 = await collection.find({}).toArray();
    const dbTeamMap2 = new Map<string, any>();
    for (const t of dbTeams2) {
        dbTeamMap2.set(normalizeTeamName(t.teamName), t);
    }

    for (const fields of subRows) {
        const csvTeamName = (fields[5] || '').trim();
        const teamNo = (fields[6] || '').trim();
        const roomNo = (fields[7] || '').trim();
        // Problem statement may span multiple lines (was joined during CSV parse)
        let ps = (fields[8] || '').trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
        const githubLink = (fields[9] || '').trim();

        if (!csvTeamName) continue;

        const normed = normalizeTeamName(csvTeamName);
        const dbTeam = dbTeamMap2.get(normed);

        if (!dbTeam) {
            console.log(`NOT FOUND in DB: "${csvTeamName}"`);
            subNotFound++;
            continue;
        }

        const updates: Record<string, any> = {};
        const changes: string[] = [];

        if (ps && ps !== (dbTeam.problemStatement || '')) {
            updates.problemStatement = ps;
            changes.push(`PS: "${ps.substring(0, 60)}..."`);
        }
        if (githubLink && githubLink !== (dbTeam.githubRepo || '')) {
            updates.githubRepo = githubLink;
            changes.push(`GitHub: ${githubLink}`);
        }
        if (roomNo && roomNo !== (dbTeam.roomNumber || '')) {
            updates.roomNumber = roomNo;
            changes.push(`Room: ${roomNo}`);
        }
        if (teamNo && teamNo !== (dbTeam.allocatedTeamId || '')) {
            updates.allocatedTeamId = teamNo;
            changes.push(`Team#: ${teamNo}`);
        }

        if (changes.length > 0) {
            console.log(`UPDATE "${dbTeam.teamName}": ${changes.join(', ')}`);
            if (!dryRun) await collection.updateOne({ _id: dbTeam._id }, { $set: updates });
            subUpdated++;
        }
    }

    console.log(`\nPart 2 done: ${subUpdated} updated, ${subNotFound} not found\n`);

    // ─── Summary ────────────────────────────────────────────────────────
    console.log('===== SUMMARY =====');
    console.log(`Part 1 (final.csv): ${updatedCount} updated, ${insertedCount} inserted, ${skippedCount} skipped`);
    console.log(`Part 2 (submissions): ${subUpdated} updated with PS/GitHub, ${subNotFound} not found`);
    if (dryRun) {
        console.log('\nDRY RUN - no changes committed. Run with --apply to commit.');
    } else {
        console.log('\nAll changes applied!');
    }

    await mongoose.disconnect();
    process.exit(0);
}

syncAll().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
