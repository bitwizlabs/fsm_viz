// One-block FSM style (legacy)
module one_block_fsm (
    input  logic clk,
    input  logic rst_n,
    input  logic go,
    input  logic stop,
    output logic running
);

typedef enum logic [1:0] {IDLE, RUN, PAUSE} state_t;
state_t state;

always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        state <= IDLE;
        running <= 1'b0;
    end else begin
        case (state)
            IDLE: begin
                running <= 1'b0;
                if (go) state <= RUN;
            end
            RUN: begin
                running <= 1'b1;
                if (stop) state <= PAUSE;
            end
            PAUSE: begin
                running <= 1'b0;
                if (go) state <= RUN;
                else if (stop) state <= IDLE;
            end
        endcase
    end
end

endmodule
