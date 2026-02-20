import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Team } from '../models/Team';
import { connectDB } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ─── LOGIN ROUTE ────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
        await connectDB();

        const { email, password } = req.body;

        if (!email || !password) {
            res.status(400).json({ success: false, message: 'Email and password are required' });
            return;
        }

        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
            return;
        }

        // Compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
            return;
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: { email: user.email, role: user.role },
        });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
});

// ─── PUBLIC STATS (no auth) ─────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
    try {
        await connectDB();
        const teams = await Team.find().lean();

        const totalTeams = teams.length;
        const batchCounts: Record<string, number> = {};
        const residencyCounts: Record<string, number> = { Hosteller: 0, 'Day Scholar': 0 };

        for (const team of teams) {
            // Leader
            const lb = (team as any).leaderBatch || 'Unknown';
            batchCounts[lb] = (batchCounts[lb] || 0) + 1;
            if (team.leaderResidency === 'Hosteller') residencyCounts['Hosteller']++;
            else residencyCounts['Day Scholar']++;

            // Members
            for (const m of team.members) {
                const mb = (m as any).batch || 'Unknown';
                batchCounts[mb] = (batchCounts[mb] || 0) + 1;
                if (m.residency === 'Hosteller') residencyCounts['Hosteller']++;
                else residencyCounts['Day Scholar']++;
            }
        }

        const totalPeople = totalTeams * 4;
        // Count checked-in teams
        const totalCheckedIn = teams.filter((t: any) => t.isCheckedIn).length;

        res.status(200).json({
            success: true,
            totalTeams,
            totalPeople,
            totalCheckedIn,
            batchCounts,
            residencyCounts,
        });
    } catch (error: any) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching stats' });
    }
});

// ─── TOGGLE CHECK-IN STATUS ─────────────────────────────────────────────────
router.put('/checkin/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();
        const { id } = req.params;
        const { status } = req.body; // Expect boolean

        const team = await Team.findById(id);
        if (!team) {
            res.status(404).json({ success: false, message: 'Team not found' });
            return;
        }

        team.isCheckedIn = status;
        await team.save();

        res.status(200).json({
            success: true,
            message: `Team ${status ? 'checked in' : 'checked out'} successfully`,
            team
        });
    } catch (error: any) {
        console.error('Check-in error:', error);
        res.status(500).json({ success: false, message: 'Server error updating check-in status' });
    }
});

// ─── GET REGISTRATIONS WITH FILTERS ─────────────────────────────────────────
router.get('/registrations', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();

        const residency = req.query.residency as string;
        const messFood = req.query.messFood as string;
        const year = req.query.year as string;
        const course = req.query.course as string;

        // Fetch all teams
        let teams = await Team.find().sort({ createdAt: -1 }).lean();

        // Apply filters
        if (residency && residency !== 'All') {
            teams = teams.filter(team => {
                const leaderMatch = team.leaderResidency === residency;
                const membersMatch = team.members.every((m: any) => m.residency === residency);
                return leaderMatch && membersMatch;
            });
        }

        if (messFood && messFood !== 'All') {
            const messFoodBoolean = messFood === 'true';
            teams = teams.filter(team => {
                const leaderMatch = team.leaderMessFood === messFoodBoolean;
                const membersMatch = team.members.some((m: any) => m.messFood === messFoodBoolean);
                return leaderMatch || membersMatch;
            });
        }

        if (year && year !== 'All') {
            teams = teams.filter(team => {
                const leaderYear = team.leaderRollNumber.substring(0, 4);
                const membersYear = team.members.some((m: any) => m.rollNumber.substring(0, 4) === year);
                return leaderYear === year || membersYear;
            });
        }

        if (course && course !== 'All') {
            teams = teams.filter(team => {
                // Extract course from roll number (e.g., 2024btech136 -> btech)
                const extractCourse = (rollNumber: string) => {
                    const match = rollNumber.toLowerCase().match(/\d{4}(btech|bba|bdes)/);
                    return match ? match[1] : '';
                };

                const leaderCourse = extractCourse(team.leaderRollNumber);
                const membersCourse = team.members.some((m: any) => extractCourse(m.rollNumber) === course.toLowerCase());
                return leaderCourse === course.toLowerCase() || membersCourse;
            });
        }

        res.status(200).json({
            success: true,
            count: teams.length,
            data: teams,
        });
    } catch (error: any) {
        console.error('Get registrations error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching registrations' });
    }
});

// ─── EXPORT AS CSV ──────────────────────────────────────────────────────────
router.get('/export', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();

        const residency = req.query.residency as string;
        const messFood = req.query.messFood as string;
        const year = req.query.year as string;
        const course = req.query.course as string;

        // Fetch all teams
        let teams = await Team.find().sort({ createdAt: -1 }).lean();

        // Apply same filters as above
        if (residency && residency !== 'All') {
            teams = teams.filter(team => {
                const leaderMatch = team.leaderResidency === residency;
                const membersMatch = team.members.every((m: any) => m.residency === residency);
                return leaderMatch && membersMatch;
            });
        }

        if (messFood && messFood !== 'All') {
            const messFoodBoolean = messFood === 'true';
            teams = teams.filter(team => {
                const leaderMatch = team.leaderMessFood === messFoodBoolean;
                const membersMatch = team.members.some((m: any) => m.messFood === messFoodBoolean);
                return leaderMatch || membersMatch;
            });
        }

        if (year && year !== 'All') {
            teams = teams.filter(team => {
                const leaderYear = team.leaderRollNumber.substring(0, 4);
                const membersYear = team.members.some((m: any) => m.rollNumber.substring(0, 4) === year);
                return leaderYear === year || membersYear;
            });
        }

        if (course && course !== 'All') {
            teams = teams.filter(team => {
                const extractCourse = (rollNumber: string) => {
                    const match = rollNumber.toLowerCase().match(/\d{4}(btech|bba|bdes)/);
                    return match ? match[1] : '';
                };

                const leaderCourse = extractCourse(team.leaderRollNumber);
                const membersCourse = team.members.some((m: any) => extractCourse(m.rollNumber) === course.toLowerCase());
                return leaderCourse === course.toLowerCase() || membersCourse;
            });
        }

        // Generate CSV
        const csvHeaders = [
            'Team Name',
            'Leader Name',
            'Leader Email',
            'Leader WhatsApp',
            'Leader Roll Number',
            'Leader Course',
            'Leader Batch',
            'Leader Residency',
            'Leader Mess Food',
            'Member 1 Name',
            'Member 1 Email',
            'Member 1 WhatsApp',
            'Member 1 Roll Number',
            'Member 1 Course',
            'Member 1 Batch',
            'Member 1 Residency',
            'Member 1 Mess Food',
            'Member 2 Name',
            'Member 2 Email',
            'Member 2 WhatsApp',
            'Member 2 Roll Number',
            'Member 2 Course',
            'Member 2 Batch',
            'Member 2 Residency',
            'Member 2 Mess Food',
            'Member 3 Name',
            'Member 3 Email',
            'Member 3 WhatsApp',
            'Member 3 Roll Number',
            'Member 3 Course',
            'Member 3 Batch',
            'Member 3 Residency',
            'Member 3 Mess Food',
            'Registration Date',
        ];

        const csvRows = teams.map(team => {
            const row = [
                team.teamName,
                team.leaderName,
                team.leaderEmail,
                team.leaderWhatsApp,
                team.leaderRollNumber,
                (team as any).leaderCourse || '',
                (team as any).leaderBatch || '',
                team.leaderResidency,
                team.leaderMessFood ? 'Yes' : 'No',
            ];

            // Add members data
            for (let i = 0; i < 3; i++) {
                const member = team.members[i];
                if (member) {
                    row.push(
                        member.name,
                        member.email,
                        member.whatsApp,
                        member.rollNumber,
                        (member as any).course || '',
                        (member as any).batch || '',
                        member.residency,
                        member.messFood ? 'Yes' : 'No'
                    );
                } else {
                    row.push('', '', '', '', '', '', '', '');
                }
            }

            row.push(new Date(team.createdAt).toISOString());

            return row;
        });

        // Escape and format CSV
        const escapeCSV = (value: any) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvContent = [
            csvHeaders.map(escapeCSV).join(','),
            ...csvRows.map(row => row.map(escapeCSV).join(',')),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="registrations_${Date.now()}.csv"`);
        res.status(200).send(csvContent);
    } catch (error: any) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, message: 'Server error during export' });
    }
});

// Toggle Check-in Status with Details
router.put('/checkin/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();
        const { id } = req.params;
        const { status, roomNumber, allocatedTeamId } = req.body; // Expanded input

        const team = await Team.findById(id);
        if (!team) {
            res.status(404).json({ success: false, message: 'Team not found' });
            return;
        }

        team.isCheckedIn = status;
        if (roomNumber !== undefined) team.roomNumber = roomNumber;
        if (allocatedTeamId !== undefined) team.allocatedTeamId = allocatedTeamId;

        await team.save();

        res.status(200).json({
            success: true,
            message: `Team check-in updated successfully`,
            team
        });
    } catch (error: any) {
        console.error('Check-in error:', error);
        res.status(500).json({ success: false, message: 'Server error updating check-in status' });
    }
});

// Toggle Extension Board Status
router.put('/extension-board/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();
        const { id } = req.params;
        const { status } = req.body; // Expect boolean

        const team = await Team.findById(id);
        if (!team) {
            res.status(404).json({ success: false, message: 'Team not found' });
            return;
        }

        team.extensionBoardGiven = status;
        await team.save();

        res.status(200).json({
            success: true,
            message: `Extension board status updated for team ${team.teamName}`,
            team
        });
    } catch (error: any) {
        console.error('Extension board update error:', error);
        res.status(500).json({ success: false, message: 'Server error updating extension board status' });
    }
});


// Admin On-Spot Registration
router.post('/register', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();
        const teamData = req.body; // Expects full team object

        // Basic validation (can be shared with public reg if refactored)
        const existingTeam = await Team.findOne({ teamName: teamData.teamName });
        if (existingTeam) {
            res.status(400).json({ success: false, message: 'Team name already exists' });
            return;
        }

        // Ensure no duplicate emails for leader
        const existingLeader = await Team.findOne({
            $or: [{ leaderEmail: teamData.leaderEmail }, { 'members.email': teamData.leaderEmail }]
        });
        if (existingLeader) {
            res.status(400).json({ success: false, message: `Leader email ${teamData.leaderEmail} is already registered` });
            return;
        }

        // Check duplicate emails for members
        for (const member of teamData.members) {
            const existingMember = await Team.findOne({
                $or: [{ leaderEmail: member.email }, { 'members.email': member.email }]
            });
            if (existingMember) {
                res.status(400).json({ success: false, message: `Member email ${member.email} is already registered` });
                return;
            }
        }

        const newTeam = new Team(teamData);
        await newTeam.save();

        res.status(201).json({ success: true, message: 'Team registered successfully', team: newTeam });

    } catch (error: any) {
        console.error('Admin Register Error:', error);
        res.status(500).json({ success: false, message: 'Server error registering team' });
    }
});


// Swap Members Endpoint
router.put('/swap-members', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await connectDB();
        const { team1Id, member1Email, team2Id, member2Email } = req.body;

        const team1 = await Team.findById(team1Id);
        const team2 = await Team.findById(team2Id);

        if (!team1 || !team2) {
            res.status(404).json({ success: false, message: 'One or both teams not found' });
            return;
        }

        // Helper to find and remove member (or leader as pseudo-member for swapping logic if needed, but simple member swap first)
        // NOTE: Swapping leaders is complex due to schema structure. Assuming member-only swap for simplicity or handling leader manually.
        // Let's implement member-to-member swap first.

        const m1Index = team1.members.findIndex(m => m.email === member1Email);
        const m2Index = team2.members.findIndex(m => m.email === member2Email);

        if (m1Index === -1 || m2Index === -1) {
            res.status(400).json({ success: false, message: 'Member not found in respective team' });
            return;
        }

        // Swap
        const member1 = team1.members[m1Index];
        const member2 = team2.members[m2Index];

        // Mongoose subdocuments might be tricky, clone strictly
        const m1Object = (member1 as any).toObject();
        const m2Object = (member2 as any).toObject();
        delete (m1Object as any)._id; // Let mongo generate new IDs or keep logic simple
        delete (m2Object as any)._id;


        team1.members[m1Index] = m2Object as any; // Type casting for simplicity here
        team2.members[m2Index] = m1Object as any;

        await team1.save();
        await team2.save();

        res.status(200).json({ success: true, message: 'Members swapped successfully' });

    } catch (error: any) {
        console.error('Swap Error:', error);
        res.status(500).json({ success: false, message: 'Server error swapping members' });
    }
});

export default router;
