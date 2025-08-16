const validateStaffData = (req, res, next) => {
    const {
        name,
        email,
        phone,
        gender,
        role_id,
        branch_id,
        salary,
        salary_type
    } = req.body;

    // Required fields for creation
    if (req.method === 'POST') {
        if (!name || !email || !phone || !gender || !role_id || !branch_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, email, phone, gender, role_id, branch_id'
            });
        }
    }

    // Validate email format
    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid email format'
        });
    }

    // Validate phone format (basic validation)
    if (phone && !phone.match(/^\+?[\d\s-]{8,}$/)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number format. Must be at least 8 digits and can include +, spaces, and hyphens'
        });
    }

    // Validate gender
    if (gender && !['male', 'female', 'other'].includes(gender.toLowerCase())) {
        return res.status(400).json({
            success: false,
            message: 'Gender must be one of: male, female, other'
        });
    }

    // Validate salary and salary_type
    if (salary !== undefined) {
        // Convert to number for validation
        const salaryNum = Number(salary);
        if (isNaN(salaryNum) || salaryNum < 0) {
            return res.status(400).json({
                success: false,
                message: 'Salary must be a positive number'
            });
        }

        // If salary is provided, salary_type is required
        if (!salary_type) {
            return res.status(400).json({
                success: false,
                message: 'salary_type is required when salary is provided'
            });
        }

        // Validate salary_type
        if (!['monthly', 'hourly'].includes(salary_type)) {
            return res.status(400).json({
                success: false,
                message: 'salary_type must be either "monthly" or "hourly"'
            });
        }
    }

    // Validate role_id format
    if (role_id && (!Number.isInteger(Number(role_id)) || Number(role_id) <= 0)) {
        return res.status(400).json({
            success: false,
            message: 'role_id must be a positive integer'
        });
    }

    // Validate branch_id format (assuming UUID format)
    if (branch_id && !branch_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid branch_id format'
        });
    }

    next();
};

module.exports = validateStaffData;
