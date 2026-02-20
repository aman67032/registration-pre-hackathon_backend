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

export default router;
