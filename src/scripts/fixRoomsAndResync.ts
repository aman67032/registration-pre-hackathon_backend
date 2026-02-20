import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

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

// ─── Room Number Normalizer ─────────────────────────────────────────────────
// Normalize all variants to "EB2 - {room}" format
// Input examples: "EB2-206", "204", "EB2", "Eb2-104", "EB-2 104", "EB 2-105",
//                 "EB 2 -202", "EB02-205", "EB-2 (202)", "EB-2 105", "EB1 105"
function normalizeRoomNumber(raw: string): string {
    if (!raw || !raw.trim()) return '';
    let r = raw.trim();

    // If it's just a plain number like "204", "104", "105"
    if (/^\d{3,4}$/.test(r)) {
        return `EB2 - ${r}`;
    }

    // Extract building and room from various formats
    // Match patterns like: EB2-206, EB-2 104, EB 2-105, Eb2 - 104, EB02-205, EB-2(202), EB1 105
    const match = r.match(/^eb\s*-?\s*(\d)\s*[-\s]*\(?\s*(\d{3,4})\s*\)?$/i);
    if (match) {
        const building = match[1]; // 1 or 2
        const room = match[2];
        return `EB${building} - ${room}`;
    }

    // Handle "EB2" alone (no room number)
    if (/^eb\s*-?\s*\d$/i.test(r)) {
        return r.toUpperCase().replace(/\s/g, '');
    }

    // Fallback: if nothing matched, return cleaned up
    return r;
}

// ─── Team Name Aliases ──────────────────────────────────────────────────────
// Submission CSV team name -> DB team name (for mismatches)
const SUBMISSION_ALIASES: Record<string, string> = {
    'jklufiles': 'Jklufi',
    'team': 'team',
    'wi-wi club': 'Wi-Wi Club',
    'she codes': 'SheCodes',
    'error 404': 'Error 404',
    'runtime t.error': 'Runtime T.EEROR',
    'hackathon_tech': 'Hackathon_tech',
    'brain codes': 'Braincodes',
    'next gen innovators': 'NextGen Innovators',
    'webwarriors': 'Web warriors',
    'team sparkx': 'spark x',
    'team paradise': 'Team Paradise',
    'codera clan': 'Codera Clan',
    'logic loop': 'Logicloop',
    'not coders': 'Not coders',
    'bug slayers': 'Bugslayers',
    'ghost protocol': 'ghost protocol',
    'the 404s': 'THE 404s',
    'ai avengers': 'AI Avengers',
    'terminal stackers': 'TERMINAL STACKERS',
    'vad': 'Team VAD',
    'out of bounds': 'out of bounce',
    'dream debuggers': 'Dream debugger',
    'knight vision': 'Knight Vision',
    'fantastic 4': 'Fantastic 4',
    'rapid resolve': 'Rapid resolve',
    'syntax error': 'syntax error',
};

async function fixData() {
    const dryRun = !process.argv.includes('--apply');
    if (dryRun) {
        console.log('DRY RUN MODE -- Run with --apply to commit.\n');
    } else {
        console.log('APPLY MODE -- Changes WILL be written.\n');
    }

    await mongoose.connect(MONGO_URI!);
    console.log('Connected to MongoDB\n');

    const db = mongoose.connection.db!;
    const collection = db.collection('Data_Collection_Pre-Hackthon_1');

    // ═══ STEP 1: Normalize all room numbers in DB ═══
    console.log('=== STEP 1: Normalizing room numbers ===\n');
    const allTeams = await collection.find({ roomNumber: { $exists: true, $ne: '' } }).toArray();
    let roomFixed = 0;

    for (const team of allTeams) {
        const oldRoom = team.roomNumber || '';
        const newRoom = normalizeRoomNumber(oldRoom);
        if (newRoom && newRoom !== oldRoom) {
            console.log(`  "${team.teamName}": "${oldRoom}" -> "${newRoom}"`);
            if (!dryRun) {
                await collection.updateOne({ _id: team._id }, { $set: { roomNumber: newRoom } });
            }
            roomFixed++;
        }
    }
    console.log(`\nRoom numbers fixed: ${roomFixed}\n`);

    // ═══ STEP 2: Re-sync missing submission data ═══
    console.log('=== STEP 2: Re-syncing missing submission teams ===\n');

    // Re-fetch all teams after room fixes
    const dbTeams = await collection.find({}).toArray();
    const dbTeamMap = new Map<string, any>();
    for (const t of dbTeams) {
        dbTeamMap.set(t.teamName.toLowerCase().trim(), t);
    }

    const subPath = path.resolve(__dirname, '../../../registration_prehackthon/public/Pre-Hack Submission of PS and GitHub Repo.csv');
    const content = fs.readFileSync(subPath, 'utf-8');
    const lines = content.split('\n').map(l => l.replace(/\r$/, ''));

    let updated = 0;
    let notFound = 0;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCSVLine(line);
        if (fields.length < 9) continue;

        const csvTeamName = (fields[5] || '').trim();
        const teamNo = (fields[6] || '').trim();
        const roomNo = (fields[7] || '').trim();
        let ps = (fields[8] || '').trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
        const githubLink = (fields[9] || '').trim();

        if (!csvTeamName) continue;

        // Try direct match first
        const key = csvTeamName.toLowerCase().trim();
        let dbTeam = dbTeamMap.get(key);

        // Try alias if direct match fails
        if (!dbTeam && SUBMISSION_ALIASES[key]) {
            dbTeam = dbTeamMap.get(SUBMISSION_ALIASES[key].toLowerCase().trim());
        }

        // Try removing spaces/special chars for fuzzy match
        if (!dbTeam) {
            const fuzzyKey = key.replace(/[\s_\-\.]+/g, '');
            for (const [dbKey, dbVal] of dbTeamMap) {
                if (dbKey.replace(/[\s_\-\.]+/g, '') === fuzzyKey) {
                    dbTeam = dbVal;
                    break;
                }
            }
        }

        if (!dbTeam) {
            console.log(`  NOT FOUND: "${csvTeamName}"`);
            notFound++;
            continue;
        }

        const normalizedRoom = normalizeRoomNumber(roomNo);
        const updates: Record<string, any> = {};
        const changes: string[] = [];

        if (ps && ps !== (dbTeam.problemStatement || '')) {
            updates.problemStatement = ps;
            changes.push('PS updated');
        }
        if (githubLink && githubLink !== (dbTeam.githubRepo || '')) {
            updates.githubRepo = githubLink;
            changes.push('GitHub updated');
        }
        if (normalizedRoom && normalizedRoom !== (dbTeam.roomNumber || '')) {
            updates.roomNumber = normalizedRoom;
            changes.push(`Room: "${dbTeam.roomNumber || ''}" -> "${normalizedRoom}"`);
        }
        if (teamNo && teamNo !== (dbTeam.allocatedTeamId || '')) {
            updates.allocatedTeamId = teamNo;
            changes.push(`Team#: ${teamNo}`);
        }

        if (changes.length > 0) {
            console.log(`  UPDATE "${dbTeam.teamName}": ${changes.join(', ')}`);
            if (!dryRun) {
                await collection.updateOne({ _id: dbTeam._id }, { $set: updates });
            }
            updated++;
        }
    }

    console.log(`\nSubmission sync: ${updated} updated, ${notFound} not found`);

    // ═══ SUMMARY ═══
    console.log('\n===== SUMMARY =====');
    console.log(`Room numbers normalized: ${roomFixed}`);
    console.log(`Submissions re-synced: ${updated}`);
    console.log(`Still not found: ${notFound}`);
    if (dryRun) console.log('\nDRY RUN - run with --apply to commit.');
    else console.log('\nAll changes applied!');

    await mongoose.disconnect();
    process.exit(0);
}

fixData().catch(err => { console.error('Error:', err); process.exit(1); });
