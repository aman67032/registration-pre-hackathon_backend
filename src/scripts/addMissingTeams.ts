import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function addMissing() {
    await mongoose.connect(process.env.MONGODB_URI!);
    const col = mongoose.connection.db!.collection('Data_Collection_Pre-Hackthon_1');

    // 1. Knight Vision — already in DB from final.csv sync, just add submission data
    const kv = await col.findOne({ teamName: { $regex: /^knight\s*vision$/i } });
    if (kv) {
        const r = await col.updateOne({ _id: kv._id }, {
            $set: {
                problemStatement: 'AI Healthcare Triage Assistant',
                githubRepo: 'https://github.com/labishbardiya/ThirdEye.git',
                roomNumber: 'EB2 - 105',
                allocatedTeamId: '58',
            }
        });
        console.log(`Knight Vision updated: ${r.modifiedCount} (was in DB as "${kv.teamName}")`);
    } else {
        // Insert as new team with leader + available members from final.csv
        await col.insertOne({
            teamName: 'Knight Vision',
            leaderName: 'Labish Bardiya',
            leaderEmail: 'labishbardiya@jklu.edu.in',
            leaderWhatsApp: '9509958988',
            leaderRollNumber: '2023BTECH106',
            leaderResidency: 'Hosteller',
            leaderMessFood: false,
            leaderCourse: 'BTech',
            leaderBatch: '2023',
            isCheckedIn: true,
            extensionBoardGiven: true,
            roomNumber: 'EB2 - 105',
            allocatedTeamId: '58',
            problemStatement: 'AI Healthcare Triage Assistant',
            githubRepo: 'https://github.com/labishbardiya/ThirdEye.git',
            members: [
                { name: 'Priyanshu Kumar', email: 'priyanshukumar@jklu.edu.in', whatsApp: '9162132852', rollNumber: '2023BTECH062', residency: 'Hosteller', messFood: false, course: 'BTech', batch: '2023' },
                { name: 'kanishk jain', email: 'kanishkjain@jklu.edu.in', whatsApp: '7877807017', rollNumber: '2023BTECH040', residency: 'Hosteller', messFood: false, course: 'BTech', batch: '2023' },
                { name: 'rakshika sharma', email: 'rakshikasharma@jkle.edu.in', whatsApp: '7891628119', rollNumber: '2023BTECH065', residency: 'Day Scholar', messFood: false, course: 'BTech', batch: '2023' },
            ],
            createdAt: new Date(),
        });
        console.log('Knight Vision INSERTED as new team');
    }

    // 2. Out of Bounds — only partial data in DB (1 member). Insert/update with submission info
    const oob = await col.findOne({ teamName: { $regex: /^out\s*of\s*boun/i } });
    if (oob) {
        const r = await col.updateOne({ _id: oob._id }, {
            $set: {
                problemStatement: 'Blood donation network (Web development)',
                githubRepo: 'https://github.com/ankit1439/Blood-Donation-Network',
                roomNumber: 'EB1 - 105',
                allocatedTeamId: '61',
            }
        });
        console.log(`Out of Bounds updated: ${r.modifiedCount} (was in DB as "${oob.teamName}")`);
    } else {
        // Insert minimal entry
        await col.insertOne({
            teamName: 'Out of Bounds',
            leaderName: 'Ankit Joshi',
            leaderEmail: 'ankitjoshi@jklu.edu.in',
            leaderWhatsApp: '',
            leaderRollNumber: '2024BTECH076',
            leaderResidency: 'Hosteller',
            leaderCourse: 'BTech',
            leaderBatch: '2024',
            isCheckedIn: false,
            extensionBoardGiven: false,
            roomNumber: 'EB1 - 105',
            allocatedTeamId: '61',
            problemStatement: 'Blood donation network (Web development)',
            githubRepo: 'https://github.com/ankit1439/Blood-Donation-Network',
            members: [
                { name: 'Sanchi dhoopia', email: 'sachidoopia@jklu.edu.in', whatsApp: '9664356901', rollNumber: '2025BTECH338', residency: 'Day Scholar', messFood: false, course: 'BTech', batch: '2025' },
                { name: 'Member 2', email: 'placeholder2@jklu.edu.in', whatsApp: '', rollNumber: '', residency: 'Hosteller', course: 'BTech', batch: '' },
                { name: 'Member 3', email: 'placeholder3@jklu.edu.in', whatsApp: '', rollNumber: '', residency: 'Hosteller', course: 'BTech', batch: '' },
            ],
            createdAt: new Date(),
        });
        console.log('Out of Bounds INSERTED as new team');
    }

    // Final count
    const total = await col.countDocuments({ problemStatement: { $exists: true, $ne: '' } });
    console.log(`\nTotal teams with submissions: ${total}`);

    await mongoose.disconnect();
    process.exit(0);
}

addMissing().catch(e => { console.error(e); process.exit(1); });
