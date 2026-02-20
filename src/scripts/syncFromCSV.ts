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

interface CSVRow {
    name: string;
    email: string;
    whatsApp: string;
    rollNumber: string;
    course: string;
    batch: string;
    residency: string;
    messFood: string;
    role: string;
    teamName: string;
    checkIn: string;
    boardAlloted: string;
    roomNumber: string;
    teamNumber: string;
}

function parseCSV(filePath: string): CSVRow[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
    const rows: CSVRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Handle quoted fields (some emails have commas in quotes)
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

        if (fields.length < 10) continue;

        rows.push({
            name: fields[0] || '',
            email: fields[1] || '',
            whatsApp: fields[2] || '',
            rollNumber: fields[3] || '',
            course: fields[4] || '',
            batch: fields[5] || '',
            residency: fields[6] || '',
            messFood: fields[7] || '',
            role: fields[8] || '',
            teamName: fields[9] || '',
            checkIn: fields[10] || '',
            boardAlloted: fields[11] || '',
            roomNumber: fields[12] || '',
            teamNumber: fields[13] || '',
        });
    }

    return rows;
}

// ─── Group CSV rows into teams ──────────────────────────────────────────────

interface CSVTeam {
    teamName: string;
    leader: CSVRow;
    members: CSVRow[];
    checkIn: boolean;
    boardAlloted: boolean;
    roomNumber: string;
    teamNumber: string;
}

// Map of known duplicate team names in CSV → actual DB team names
const TEAM_NAME_ALIASES: Record<string, string> = {
    'vad': 'Team VAD',
    'errror404': 'Error 404',
    'akira': 'Akira',   // The re-registration at line 278
    'knight vision': 'knight vision', // keep as-is, new team
};

function groupIntoTeams(rows: CSVRow[]): CSVTeam[] {
    const teamMap = new Map<string, CSVRow[]>();

    for (const row of rows) {
        if (!row.teamName) continue; // skip standalone individuals without team names
        const key = row.teamName.trim();
        if (!teamMap.has(key)) {
            teamMap.set(key, []);
        }
        teamMap.get(key)!.push(row);
    }

    const teams: CSVTeam[] = [];
    for (const [teamName, members] of teamMap) {
        const leader = members.find(m => m.role.toLowerCase() === 'leader');
        if (!leader) {
            console.log(`⚠️  Team "${teamName}" has no leader, skipping`);
            continue;
        }

        const memberRows = members.filter(m => m.role.toLowerCase() !== 'leader');
        const checkInVal = leader.checkIn.trim().toLowerCase();
        const boardVal = leader.boardAlloted.trim().toLowerCase();

        teams.push({
            teamName,
            leader,
            members: memberRows,
            checkIn: checkInVal === 'in',
            boardAlloted: boardVal === 'yes' || boardVal === 'yers' || boardVal === 'yez',
            roomNumber: leader.roomNumber.trim(),
            teamNumber: leader.teamNumber.trim(),
        });
    }

    return teams;
}

// ─── Normalize helpers ──────────────────────────────────────────────────────

function normalizeCourse(c: string): string {
    const lower = c.toLowerCase().trim();
    if (lower === 'btech' || lower === 'b.tech') return 'BTech';
    if (lower === 'bba') return 'BBA';
    if (lower === 'bdes') return 'BDes';
    if (lower === 'hsb') return 'HSB';
    return 'BTech'; // default
}

function normalizeResidency(r: string): string {
    const lower = r.toLowerCase().trim();
    if (lower.includes('host')) return 'Hosteller';
    return 'Day Scholar';
}

function normalizeMessFood(mf: string): boolean {
    return mf.toLowerCase().trim() === 'yes';
}

// ─── Main sync logic ────────────────────────────────────────────────────────

async function syncFromCSV() {
    const dryRun = !process.argv.includes('--apply');

    if (dryRun) {
        console.log('🔍 DRY RUN MODE — No changes will be written to the database.');
        console.log('   Run with --apply to commit changes.\n');
    } else {
        console.log('🚀 APPLY MODE — Changes WILL be written to the database.\n');
    }

    await mongoose.connect(MONGO_URI!);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db!;
    const collection = db.collection('Data_Collection_Pre-Hackthon_1');

    // Read CSV
    const csvPath = path.resolve(__dirname, '../../../registration_prehackthon/public/final.csv');
    console.log(`📄 Reading CSV from: ${csvPath}`);
    const rows = parseCSV(csvPath);
    console.log(`   Parsed ${rows.length} rows\n`);

    const csvTeams = groupIntoTeams(rows);
    console.log(`   Grouped into ${csvTeams.length} teams\n`);

    // Fetch all existing teams from DB
    const dbTeams = await collection.find({}).toArray();
    console.log(`📦 Found ${dbTeams.length} teams in database\n`);

    // Build a lookup map: lowercase team name → DB doc
    const dbTeamMap = new Map<string, any>();
    for (const t of dbTeams) {
        dbTeamMap.set(t.teamName.toLowerCase().trim(), t);
    }

    // ─── Statistics ─────────────────────────────────────────────────────
    let updatedCount = 0;
    let insertedCount = 0;
    let skippedCount = 0;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('                    CHANGES REPORT                        ');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const csvTeam of csvTeams) {
        // Check for aliases (duplicate team names that map to existing DB teams)
        const aliasKey = csvTeam.teamName.toLowerCase().trim();
        const resolvedName = TEAM_NAME_ALIASES[aliasKey] || csvTeam.teamName;
        const dbTeam = dbTeamMap.get(resolvedName.toLowerCase().trim()) || dbTeamMap.get(aliasKey);

        if (dbTeam) {
            // ─── UPDATE existing team ───────────────────────────────
            const updates: Record<string, any> = {};
            const changes: string[] = [];

            // Check-in
            if (csvTeam.checkIn && !dbTeam.isCheckedIn) {
                updates.isCheckedIn = true;
                changes.push('isCheckedIn: false → true');
            }

            // Extension board
            if (csvTeam.boardAlloted && !dbTeam.extensionBoardGiven) {
                updates.extensionBoardGiven = true;
                changes.push('extensionBoardGiven: false → true');
            }

            // Room number
            if (csvTeam.roomNumber && csvTeam.roomNumber !== (dbTeam.roomNumber || '')) {
                updates.roomNumber = csvTeam.roomNumber;
                changes.push(`roomNumber: "${dbTeam.roomNumber || ''}" → "${csvTeam.roomNumber}"`);
            }

            // Team number / allocated team ID
            if (csvTeam.teamNumber && csvTeam.teamNumber !== (dbTeam.allocatedTeamId || '')) {
                updates.allocatedTeamId = csvTeam.teamNumber;
                changes.push(`allocatedTeamId: "${dbTeam.allocatedTeamId || ''}" → "${csvTeam.teamNumber}"`);
            }

            // ─── Leader field changes ───────────────────────────────
            const csvLeader = csvTeam.leader;
            const normLeaderEmail = csvLeader.email.toLowerCase().trim();
            if (normLeaderEmail && normLeaderEmail !== (dbTeam.leaderEmail || '').toLowerCase()) {
                updates.leaderName = csvLeader.name;
                updates.leaderEmail = normLeaderEmail;
                updates.leaderWhatsApp = csvLeader.whatsApp.replace(/\s/g, '');
                updates.leaderRollNumber = csvLeader.rollNumber.toUpperCase().trim();
                updates.leaderResidency = normalizeResidency(csvLeader.residency);
                updates.leaderMessFood = normalizeMessFood(csvLeader.messFood);
                updates.leaderCourse = normalizeCourse(csvLeader.course);
                updates.leaderBatch = csvLeader.batch.trim();
                changes.push(`leader: "${dbTeam.leaderName}" (${dbTeam.leaderEmail}) → "${csvLeader.name}" (${normLeaderEmail})`);
            }

            // ─── Member changes ─────────────────────────────────────
            if (csvTeam.members.length === 3) {
                const dbMembers: any[] = dbTeam.members || [];
                // Compare by collecting emails from both sides
                const dbMemberEmails = new Set(dbMembers.map((m: any) => (m.email || '').toLowerCase().trim()));
                const csvMemberEmails = new Set(csvTeam.members.map(m => m.email.toLowerCase().trim()));

                // Check if member set has changed
                const membersChanged = csvTeam.members.some(m => !dbMemberEmails.has(m.email.toLowerCase().trim())) ||
                    dbMembers.some((m: any) => !csvMemberEmails.has((m.email || '').toLowerCase().trim()));

                if (membersChanged) {
                    updates.members = csvTeam.members.map(m => ({
                        name: m.name,
                        email: m.email.toLowerCase().trim(),
                        whatsApp: m.whatsApp.replace(/\s/g, ''),
                        rollNumber: m.rollNumber.toUpperCase().trim(),
                        residency: normalizeResidency(m.residency),
                        messFood: normalizeMessFood(m.messFood),
                        course: normalizeCourse(m.course),
                        batch: m.batch.trim(),
                    }));

                    const removedEmails = dbMembers
                        .filter((m: any) => !csvMemberEmails.has((m.email || '').toLowerCase().trim()))
                        .map((m: any) => `${m.name} (${m.email})`);
                    const addedEmails = csvTeam.members
                        .filter(m => !dbMemberEmails.has(m.email.toLowerCase().trim()))
                        .map(m => `${m.name} (${m.email})`);

                    if (removedEmails.length) changes.push(`members removed: ${removedEmails.join(', ')}`);
                    if (addedEmails.length) changes.push(`members added: ${addedEmails.join(', ')}`);
                }
            }

            if (changes.length > 0) {
                console.log(`🔄 UPDATE "${dbTeam.teamName}" (CSV: "${csvTeam.teamName}"):`);
                changes.forEach(c => console.log(`   • ${c}`));
                console.log('');

                if (!dryRun) {
                    await collection.updateOne({ _id: dbTeam._id }, { $set: updates });
                }
                updatedCount++;
            }
        } else {
            // ─── NEW team ───────────────────────────────────────────
            if (csvTeam.members.length !== 3) {
                console.log(`⏭️  SKIP "${csvTeam.teamName}" — has ${csvTeam.members.length} member(s) instead of 3`);
                console.log('');
                skippedCount++;
                continue;
            }

            // Build team document
            const newTeamDoc = {
                teamName: csvTeam.teamName,
                leaderName: csvTeam.leader.name,
                leaderEmail: csvTeam.leader.email.toLowerCase().trim(),
                leaderWhatsApp: csvTeam.leader.whatsApp.replace(/\s/g, ''),
                leaderRollNumber: csvTeam.leader.rollNumber.toUpperCase().trim(),
                leaderResidency: normalizeResidency(csvTeam.leader.residency),
                leaderMessFood: normalizeMessFood(csvTeam.leader.messFood),
                leaderCourse: normalizeCourse(csvTeam.leader.course),
                leaderBatch: csvTeam.leader.batch.trim(),
                isCheckedIn: csvTeam.checkIn,
                extensionBoardGiven: csvTeam.boardAlloted,
                roomNumber: csvTeam.roomNumber || undefined,
                allocatedTeamId: csvTeam.teamNumber || undefined,
                members: csvTeam.members.map(m => ({
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

            console.log(`➕ INSERT "${csvTeam.teamName}":`);
            console.log(`   Leader: ${csvTeam.leader.name} (${csvTeam.leader.email})`);
            console.log(`   Members: ${csvTeam.members.map(m => m.name).join(', ')}`);
            console.log(`   Checked in: ${csvTeam.checkIn}, Board: ${csvTeam.boardAlloted}`);
            if (csvTeam.roomNumber) console.log(`   Room: ${csvTeam.roomNumber}`);
            if (csvTeam.teamNumber) console.log(`   Team #: ${csvTeam.teamNumber}`);
            console.log('');

            if (!dryRun) {
                await collection.insertOne(newTeamDoc);
            }
            insertedCount++;
        }
    }

    // ─── Handle standalone individuals (no team name) ───────────────────
    const standaloneRows = rows.filter(r => !r.teamName.trim());
    if (standaloneRows.length > 0) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('            SKIPPED STANDALONE INDIVIDUALS                ');
        console.log('═══════════════════════════════════════════════════════════\n');
        for (const row of standaloneRows) {
            console.log(`⏭️  "${row.name}" (${row.email}) — no team name, skipping`);
        }
        console.log('');
    }

    // ─── Summary ────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                      SUMMARY                            ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   ✅ Updated: ${updatedCount} teams`);
    console.log(`   ➕ Inserted: ${insertedCount} new teams`);
    console.log(`   ⏭️  Skipped: ${skippedCount} (incomplete)`);
    console.log(`      Standalone individuals: ${standaloneRows.length}`);
    if (dryRun) {
        console.log('\n   ⚠️  This was a DRY RUN. Run with --apply to commit changes.');
    } else {
        console.log('\n   🎉 All changes applied to database!');
    }

    await mongoose.disconnect();
    process.exit(0);
}

syncFromCSV().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
